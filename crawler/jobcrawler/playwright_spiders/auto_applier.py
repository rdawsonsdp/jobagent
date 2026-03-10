"""
Playwright-based auto-applier for job applications.

Takes approved items from the auto_apply_queue, navigates to the job URL,
fills form fields, and optionally submits the application.

Safety guardrails:
  - dry_run mode is default True (for first 2 weeks after deployment)
  - Max 10 applications per day
  - Max 1 application per company per week
  - Screenshots taken before every submit action
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PlaywrightTimeout

from jobcrawler.db.supabase_client import SupabaseDB

logger = logging.getLogger(__name__)

# Directory for application screenshots
SCREENSHOTS_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "screenshots"


class AutoApplier:
    """
    Playwright-based auto-applier with safety guardrails.

    Attributes:
        dry_run: If True, fills forms but does NOT click submit.
        max_daily: Maximum applications per day.
        max_per_company_per_week: Maximum applications per company per week.
    """

    def __init__(
        self,
        dry_run: bool = True,
        max_daily: int = 10,
        max_per_company_per_week: int = 1,
    ) -> None:
        self.dry_run = dry_run
        self.max_daily = max_daily
        self.max_per_company_per_week = max_per_company_per_week
        self.db = SupabaseDB()
        self.daily_count = 0
        self.company_counts: dict[str, int] = {}
        self._browser: Browser | None = None

    async def run(self) -> dict[str, Any]:
        """
        Main entry point. Processes all approved auto-apply items.

        Returns a summary dict with counts of processed, submitted,
        skipped, and failed applications.
        """
        summary = {
            "processed": 0,
            "submitted": 0,
            "skipped": 0,
            "failed": 0,
            "dry_run": self.dry_run,
        }

        # Ensure screenshots directory exists
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

        # Load approved items
        try:
            approved_items = self.db.get_approved_auto_applies()
        except Exception as e:
            logger.error("Failed to load approved auto-apply items: %s", e)
            return summary

        if not approved_items:
            logger.info("No approved auto-apply items to process.")
            return summary

        logger.info(
            "Found %d approved auto-apply items (dry_run=%s)",
            len(approved_items),
            self.dry_run,
        )

        # Load recent application history for guardrail checks
        self._load_application_history()

        async with async_playwright() as p:
            self._browser = await p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )

            try:
                for item in approved_items:
                    if self.daily_count >= self.max_daily:
                        logger.info(
                            "Reached daily application limit (%d). Stopping.",
                            self.max_daily,
                        )
                        break

                    summary["processed"] += 1
                    result = await self._process_item(item)

                    if result == "submitted":
                        summary["submitted"] += 1
                    elif result == "skipped":
                        summary["skipped"] += 1
                    else:
                        summary["failed"] += 1

            finally:
                await self._browser.close()

        logger.info("Auto-applier summary: %s", summary)
        return summary

    def _load_application_history(self) -> None:
        """Load recent application counts for guardrail enforcement."""
        try:
            # Reset daily counter
            self.daily_count = 0
            self.company_counts = {}

            # Query recent applications from the last 7 days
            recent = self.db.get_recent_applications(days=7)
            today = datetime.utcnow().date()

            for app in recent:
                # Count today's applications
                applied_at = app.get("submitted_at", "")
                if applied_at:
                    try:
                        app_date = datetime.fromisoformat(
                            applied_at.replace("Z", "+00:00")
                        ).date()
                        if app_date == today:
                            self.daily_count += 1
                    except (ValueError, TypeError):
                        pass

                # Count per-company applications this week
                company = (app.get("company") or "").lower().strip()
                if company:
                    self.company_counts[company] = (
                        self.company_counts.get(company, 0) + 1
                    )

            logger.info(
                "Application history: %d today, %d companies this week",
                self.daily_count,
                len(self.company_counts),
            )
        except Exception as e:
            logger.warning("Could not load application history: %s", e)

    async def _process_item(self, item: dict[str, Any]) -> str:
        """
        Process a single auto-apply item.

        Returns: "submitted", "skipped", or "failed"
        """
        item_id = item.get("id", "unknown")
        job_url = item.get("job_url", "")
        company = (item.get("company") or "").strip()
        job_title = item.get("job_title", "")

        logger.info(
            "Processing auto-apply #%s: '%s' at '%s'",
            item_id, job_title, company,
        )

        # Guardrail: company-per-week limit
        company_key = company.lower()
        if company_key and self.company_counts.get(company_key, 0) >= self.max_per_company_per_week:
            logger.info(
                "Skipping '%s' at '%s' -- company weekly limit reached",
                job_title, company,
            )
            self._update_status(item_id, "skipped", "Company weekly limit reached")
            return "skipped"

        if not job_url:
            logger.warning("Auto-apply item #%s has no job_url", item_id)
            self._update_status(item_id, "failed", "No job URL")
            return "failed"

        try:
            context = await self._browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            try:
                # Navigate to job page
                await page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(2000)

                # Look for apply button
                apply_button = await self._find_apply_button(page)

                if not apply_button:
                    logger.warning("No apply button found for '%s'", job_title)
                    self._update_status(item_id, "failed", "Apply button not found")
                    return "failed"

                # Click apply button
                await apply_button.click()
                await page.wait_for_timeout(3000)

                # Fill form fields
                form_data = item.get("form_data", {}) or {}
                cover_letter = item.get("cover_letter_draft", "")
                await self._fill_form(page, form_data, cover_letter)

                # Take screenshot before submit
                screenshot_path = (
                    SCREENSHOTS_DIR
                    / f"apply_{item_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.png"
                )
                await page.screenshot(path=str(screenshot_path), full_page=True)
                logger.info("Screenshot saved: %s", screenshot_path)

                if self.dry_run:
                    logger.info(
                        "DRY RUN: Would submit application for '%s' at '%s'",
                        job_title, company,
                    )
                    self._update_status(
                        item_id, "dry_run_complete",
                        f"Form filled, screenshot at {screenshot_path}",
                    )
                    self.daily_count += 1
                    return "submitted"

                # Actually submit
                submit_button = await self._find_submit_button(page)
                if submit_button:
                    await submit_button.click()
                    await page.wait_for_timeout(5000)

                    # Take post-submit screenshot
                    post_screenshot = (
                        SCREENSHOTS_DIR
                        / f"submitted_{item_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.png"
                    )
                    await page.screenshot(path=str(post_screenshot), full_page=True)

                    self._update_status(
                        item_id, "submitted",
                        f"Application submitted. Screenshots: {screenshot_path}, {post_screenshot}",
                    )
                    self.daily_count += 1

                    # Update company count
                    if company_key:
                        self.company_counts[company_key] = (
                            self.company_counts.get(company_key, 0) + 1
                        )

                    return "submitted"
                else:
                    logger.warning("Submit button not found for '%s'", job_title)
                    self._update_status(item_id, "failed", "Submit button not found")
                    return "failed"

            except PlaywrightTimeout:
                logger.error("Timeout processing auto-apply for '%s'", job_title)
                self._update_status(item_id, "failed", "Page timeout")
                return "failed"
            finally:
                await page.close()
                await context.close()

        except Exception as e:
            logger.error("Error processing auto-apply #%s: %s", item_id, e)
            self._update_status(item_id, "failed", str(e))
            return "failed"

    async def _find_apply_button(self, page: Page) -> Any | None:
        """Locate the apply/easy-apply button on a job page."""
        selectors = [
            "button:has-text('Easy Apply')",
            "button:has-text('Apply Now')",
            "button:has-text('Apply')",
            "a:has-text('Easy Apply')",
            "a:has-text('Apply Now')",
            "a:has-text('Apply')",
            "[data-control-name='jobdetails_topcard_inapply']",
            ".jobs-apply-button",
            "#apply-button",
        ]

        for selector in selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=2000):
                    return element
            except Exception:
                continue

        return None

    async def _find_submit_button(self, page: Page) -> Any | None:
        """Locate the final submit button on an application form."""
        selectors = [
            "button:has-text('Submit application')",
            "button:has-text('Submit')",
            "button[type='submit']",
            "input[type='submit']",
            "button:has-text('Send application')",
            "button:has-text('Apply')",
        ]

        for selector in selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=2000):
                    return element
            except Exception:
                continue

        return None

    async def _fill_form(
        self,
        page: Page,
        form_data: dict[str, Any],
        cover_letter: str,
    ) -> None:
        """
        Fill in application form fields.

        form_data keys map to form field identifiers (name, id, label text).
        """
        if not form_data and not cover_letter:
            return

        # Common field mappings
        field_mappings = {
            "first_name": [
                "input[name*='first' i]",
                "input[id*='first' i]",
                "input[placeholder*='First' i]",
            ],
            "last_name": [
                "input[name*='last' i]",
                "input[id*='last' i]",
                "input[placeholder*='Last' i]",
            ],
            "email": [
                "input[type='email']",
                "input[name*='email' i]",
                "input[id*='email' i]",
            ],
            "phone": [
                "input[type='tel']",
                "input[name*='phone' i]",
                "input[id*='phone' i]",
            ],
            "linkedin_url": [
                "input[name*='linkedin' i]",
                "input[id*='linkedin' i]",
                "input[placeholder*='LinkedIn' i]",
            ],
            "website": [
                "input[name*='website' i]",
                "input[name*='portfolio' i]",
                "input[id*='website' i]",
            ],
        }

        for field_name, value in form_data.items():
            if not value:
                continue

            selectors = field_mappings.get(field_name, [f"input[name='{field_name}']"])

            for selector in selectors:
                try:
                    element = page.locator(selector).first
                    if await element.is_visible(timeout=1000):
                        await element.fill(str(value))
                        logger.debug("Filled field '%s'", field_name)
                        break
                except Exception:
                    continue

        # Fill cover letter if there's a textarea for it
        if cover_letter:
            cover_selectors = [
                "textarea[name*='cover' i]",
                "textarea[id*='cover' i]",
                "textarea[placeholder*='Cover' i]",
                "textarea[name*='letter' i]",
                "textarea[name*='message' i]",
            ]

            for selector in cover_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.is_visible(timeout=1000):
                        await element.fill(cover_letter)
                        logger.debug("Filled cover letter field")
                        break
                except Exception:
                    continue

    def _update_status(self, item_id: str, status: str, notes: str = "") -> None:
        """Update the auto_apply_queue item status in Supabase."""
        try:
            self.db.update_auto_apply_status(
                item_id,
                status=status,
                notes=notes,
                applied_at=datetime.utcnow().isoformat() if status == "submitted" else None,
            )
        except Exception as e:
            logger.error("Failed to update auto-apply status for #%s: %s", item_id, e)


def run_auto_applier(
    dry_run: bool = True,
    max_daily: int = 10,
    max_per_company_per_week: int = 1,
) -> dict[str, Any]:
    """Synchronous wrapper to run the async auto-applier."""
    applier = AutoApplier(
        dry_run=dry_run,
        max_daily=max_daily,
        max_per_company_per_week=max_per_company_per_week,
    )
    return asyncio.run(applier.run())
