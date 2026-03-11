"""
Indeed Apply automation module.

Handles the full Indeed application flow:
  1. Session management -- loads/saves Playwright storage_state from the
     ``browser_sessions`` table (platform='indeed').
  2. Navigates to an Indeed job URL and clicks "Apply now".
  3. Detects whether the apply form is Indeed's own form or an external ATS.
  4. For Indeed's native form: uploads resume, fills contact info from
     ``user_profiles``, answers screening questions via Claude AI, reviews
     the application, and submits (or stops in dry_run mode).
  5. For external ATS redirects: logs as "external_ats" and skips.

Safety guardrails mirror AutoApplier:
  - dry_run mode defaults to True
  - Max daily application limit
  - Max per-company-per-week limit
  - Screenshots captured before every submit action
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Page,
    TimeoutError as PlaywrightTimeout,
)

from jobcrawler.ai.claude_client import ClaudeClient
from jobcrawler.db.supabase_client import SupabaseDB

logger = logging.getLogger(__name__)

SCREENSHOTS_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "screenshots"

# Indeed-specific constants
INDEED_BASE = "https://www.indeed.com"
INDEED_LOGIN_URL = "https://secure.indeed.com/auth"
INDEED_APPLY_ORIGIN = "https://m5.apply.indeed.com"

# Maximum time (ms) to wait for the manual-login flow before giving up.
MANUAL_LOGIN_TIMEOUT_MS = 120_000  # 2 minutes


class IndeedApplier:
    """
    Playwright-based Indeed Apply automation.

    Attributes:
        dry_run: If True, fills forms but does NOT click the final submit.
        max_daily: Maximum applications per day.
        max_per_company_per_week: Maximum applications per company per week.
    """

    def __init__(
        self,
        dry_run: bool = True,
        max_daily: int = 10,
        max_per_company_per_week: int = 1,
        resume_path: str | None = None,
    ) -> None:
        self.dry_run = dry_run
        self.max_daily = max_daily
        self.max_per_company_per_week = max_per_company_per_week
        self.resume_path = resume_path or os.getenv("RESUME_PATH", "")

        self.db = SupabaseDB()
        self.ai = ClaudeClient()

        self.daily_count = 0
        self.company_counts: dict[str, int] = {}

        self._browser: Browser | None = None
        self._context: BrowserContext | None = None

        # Cached data loaded once per run
        self._user_profile: dict[str, Any] | None = None
        self._resume_data: dict[str, Any] | None = None

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def run(self, job_items: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Process a list of Indeed job items.

        Each *job_item* dict should contain at minimum:
            - ``id``: queue/job ID for status tracking
            - ``job_url``: the Indeed job page URL
            - ``job_title``: title (for logging)
            - ``company``: company name
            - ``job_id``: (optional) FK to jobs table

        Returns:
            Summary dict with processed / submitted / skipped / failed counts.
        """
        summary: dict[str, Any] = {
            "processed": 0,
            "submitted": 0,
            "skipped": 0,
            "failed": 0,
            "external_ats": 0,
            "dry_run": self.dry_run,
        }

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

        if not job_items:
            logger.info("No Indeed job items to process.")
            return summary

        # Pre-load shared data
        self._user_profile = self.db.get_user_profile()
        if not self._user_profile:
            logger.error("No user profile found. Cannot proceed.")
            return summary

        resume_record = self.db.get_active_resume()
        self._resume_data = (resume_record or {}).get("parsed_data", {}) or {}

        self._load_application_history()

        logger.info(
            "IndeedApplier: %d items, dry_run=%s",
            len(job_items),
            self.dry_run,
        )

        async with async_playwright() as pw:
            self._browser = await pw.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )

            try:
                # Authenticate (load session or manual login)
                session_ok = await self._ensure_session()
                if not session_ok:
                    logger.error("Indeed session could not be established.")
                    return summary

                for item in job_items:
                    if self.daily_count >= self.max_daily:
                        logger.info(
                            "Daily limit reached (%d). Stopping.",
                            self.max_daily,
                        )
                        break

                    summary["processed"] += 1
                    result = await self._process_item(item)

                    if result == "submitted":
                        summary["submitted"] += 1
                    elif result == "skipped":
                        summary["skipped"] += 1
                    elif result == "external_ats":
                        summary["external_ats"] += 1
                    else:
                        summary["failed"] += 1

            finally:
                # Persist the session state before closing
                await self._save_session()
                if self._context:
                    await self._context.close()
                await self._browser.close()

        logger.info("IndeedApplier summary: %s", summary)
        return summary

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    async def _ensure_session(self) -> bool:
        """
        Load a saved Playwright storage_state for Indeed, or open a visible
        browser for manual login if none exists.

        Returns True if a valid session is available afterwards.
        """
        assert self._browser is not None

        session_row = self.db.get_browser_session("indeed")
        storage_state: dict[str, Any] | None = None

        if session_row:
            raw = session_row.get("storage_state")
            if isinstance(raw, str):
                try:
                    storage_state = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    storage_state = None
            elif isinstance(raw, dict):
                storage_state = raw

        if storage_state:
            logger.info("Loaded existing Indeed browser session.")
            self._context = await self._browser.new_context(
                storage_state=storage_state,
                viewport={"width": 1280, "height": 900},
                user_agent=self._user_agent(),
            )
            # Validate: navigate to Indeed and check we're not bounced to login
            if await self._validate_session():
                return True
            logger.warning("Saved session is stale. Falling back to manual login.")
            await self._context.close()
            self._context = None

        # No valid session -- open visible browser for manual login
        return await self._manual_login()

    async def _validate_session(self) -> bool:
        """
        Check whether the current context is actually logged in.

        Opens a lightweight Indeed page and checks we don't end up on the
        login/auth page.
        """
        if not self._context:
            return False

        page = await self._context.new_page()
        try:
            await page.goto(
                f"{INDEED_BASE}/account/view",
                wait_until="domcontentloaded",
                timeout=20_000,
            )
            current = page.url
            # If we landed on the auth/login page, session is invalid
            if "secure.indeed.com/auth" in current or "/login" in current:
                return False
            return True
        except PlaywrightTimeout:
            return False
        finally:
            await page.close()

    async def _manual_login(self) -> bool:
        """
        Open a visible browser window and wait for the user to log in to
        Indeed manually.  Returns True once the user is past the login page.
        """
        assert self._browser is not None

        logger.info(
            "Opening browser for manual Indeed login. "
            "Please log in within %d seconds.",
            MANUAL_LOGIN_TIMEOUT_MS // 1000,
        )

        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=self._user_agent(),
        )
        page = await self._context.new_page()
        await page.goto(INDEED_LOGIN_URL, wait_until="domcontentloaded")

        # Poll until URL leaves the auth domain
        try:
            await page.wait_for_url(
                lambda url: "secure.indeed.com/auth" not in url and "/login" not in url,
                timeout=MANUAL_LOGIN_TIMEOUT_MS,
            )
        except PlaywrightTimeout:
            logger.error("Manual login timed out.")
            await page.close()
            return False

        await page.wait_for_timeout(2000)  # let cookies settle
        logger.info("Manual login detected. Saving session.")
        await page.close()
        return True

    async def _save_session(self) -> None:
        """Persist the current browser context's storage state to DB."""
        if not self._context:
            return
        try:
            state = await self._context.storage_state()
            self.db.save_browser_session("indeed", state)
            logger.info("Indeed browser session saved.")
        except Exception as exc:
            logger.warning("Failed to save Indeed session: %s", exc)

    # ------------------------------------------------------------------
    # Application history (guardrails)
    # ------------------------------------------------------------------

    def _load_application_history(self) -> None:
        """Load recent application counts for guardrail enforcement."""
        try:
            self.daily_count = 0
            self.company_counts = {}

            recent = self.db.get_recent_applications(days=7)
            today = datetime.utcnow().date()

            for app in recent:
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
        except Exception as exc:
            logger.warning("Could not load application history: %s", exc)

    # ------------------------------------------------------------------
    # Process a single job item
    # ------------------------------------------------------------------

    async def _process_item(self, item: dict[str, Any]) -> str:
        """
        Apply to a single Indeed job.

        Returns one of: ``"submitted"``, ``"skipped"``, ``"external_ats"``,
        or ``"failed"``.
        """
        item_id = item.get("id", "unknown")
        job_url = item.get("job_url", "")
        company = (item.get("company") or "").strip()
        job_title = item.get("job_title", "")
        job_id = item.get("job_id")

        logger.info(
            "Processing Indeed apply #%s: '%s' at '%s'",
            item_id, job_title, company,
        )

        # Guardrail: company-per-week
        company_key = company.lower()
        if (
            company_key
            and self.company_counts.get(company_key, 0)
            >= self.max_per_company_per_week
        ):
            logger.info("Skipping '%s' -- company weekly limit reached", job_title)
            self._record_attempt(
                job_id=job_id,
                status="skipped",
                notes="Company weekly limit reached",
            )
            return "skipped"

        if not job_url:
            logger.warning("Item #%s has no job_url", item_id)
            self._record_attempt(job_id=job_id, status="failed", notes="No job URL")
            return "failed"

        assert self._context is not None
        page = await self._context.new_page()

        try:
            # 1. Navigate to the job page
            await page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2000)

            # 2. Click the apply button
            apply_btn = await self._find_apply_button(page)
            if not apply_btn:
                logger.warning("Apply button not found for '%s'", job_title)
                await self._screenshot(page, item_id, "no_apply_btn")
                self._record_attempt(
                    job_id=job_id,
                    status="failed",
                    notes="Apply button not found",
                )
                return "failed"

            await apply_btn.click()
            await page.wait_for_timeout(3000)

            # 3. Detect: Indeed form vs external ATS
            if self._is_external_ats(page):
                logger.info(
                    "Job '%s' redirects to external ATS (%s). Skipping.",
                    job_title,
                    page.url,
                )
                await self._screenshot(page, item_id, "external_ats")
                self._record_attempt(
                    job_id=job_id,
                    status="external_ats",
                    notes=f"External ATS: {page.url}",
                )
                return "external_ats"

            # 4. Indeed's own application form -- walk through pages
            result = await self._fill_indeed_application(page, item)
            return result

        except PlaywrightTimeout:
            logger.error("Timeout applying to '%s'", job_title)
            await self._screenshot(page, item_id, "timeout")
            self._record_attempt(
                job_id=job_id, status="failed", notes="Page timeout"
            )
            return "failed"
        except Exception as exc:
            logger.error("Error applying to '%s': %s", job_title, exc, exc_info=True)
            await self._screenshot(page, item_id, "error")
            self._record_attempt(
                job_id=job_id, status="failed", error_message=str(exc)
            )
            return "failed"
        finally:
            await page.close()

    # ------------------------------------------------------------------
    # Indeed form detection
    # ------------------------------------------------------------------

    @staticmethod
    def _is_external_ats(page: Page) -> bool:
        """Return True if the current page is NOT on Indeed's apply domain."""
        url = page.url.lower()
        # Indeed's own apply form is served from m5.apply.indeed.com or
        # smartapply.indeed.com; anything else is an external ATS.
        if "indeed.com" in url:
            return False
        return True

    # ------------------------------------------------------------------
    # Find the apply button
    # ------------------------------------------------------------------

    async def _find_apply_button(self, page: Page) -> Any | None:
        """Locate the 'Apply now' / 'Apply on company site' button."""
        selectors = [
            # Indeed-specific selectors
            "#indeedApplyButton",
            "button[id='indeedApplyButton']",
            "[data-testid='indeedApplyButton']",
            "button.indeed-apply-button",
            # Text-based
            "button:has-text('Apply now')",
            "button:has-text('Apply on company site')",
            "a:has-text('Apply now')",
            "a:has-text('Apply on company site')",
            # Fallbacks
            "button:has-text('Apply')",
            "a:has-text('Apply')",
        ]

        for selector in selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=2000):
                    return element
            except Exception:
                continue

        return None

    # ------------------------------------------------------------------
    # Walk through Indeed's multi-page apply form
    # ------------------------------------------------------------------

    async def _fill_indeed_application(
        self,
        page: Page,
        item: dict[str, Any],
    ) -> str:
        """
        Walk through each page of Indeed's apply form:
        resume -> contact info -> screening questions -> review -> submit.

        Returns ``"submitted"`` or ``"failed"``.
        """
        item_id = item.get("id", "unknown")
        job_id = item.get("job_id")
        job_title = item.get("job_title", "")
        company = (item.get("company") or "").strip()
        company_key = company.lower()

        max_pages = 10  # safety limit to avoid infinite loops

        for page_num in range(max_pages):
            await page.wait_for_timeout(1500)
            logger.info("Indeed apply page %d – URL: %s", page_num + 1, page.url)

            # --- Resume upload page ---
            if await self._page_has_resume_upload(page):
                await self._handle_resume_upload(page)

            # --- Contact info page ---
            if await self._page_has_contact_fields(page):
                await self._fill_contact_info(page)

            # --- Screening questions ---
            if await self._page_has_screening_questions(page):
                await self._handle_screening_questions(page, item)

            # --- Review / final submit page ---
            if await self._is_review_page(page):
                screenshot_path = await self._screenshot(page, item_id, "review")

                if self.dry_run:
                    logger.info(
                        "DRY RUN: Would submit application for '%s' at '%s'",
                        job_title,
                        company,
                    )
                    self._record_attempt(
                        job_id=job_id,
                        status="dry_run_complete",
                        notes=f"Form filled, screenshot at {screenshot_path}",
                        screenshot_path=str(screenshot_path) if screenshot_path else None,
                    )
                    self.daily_count += 1
                    return "submitted"

                # Actually submit
                submitted = await self._click_submit(page)
                if submitted:
                    post_screenshot = await self._screenshot(
                        page, item_id, "submitted"
                    )
                    self._record_attempt(
                        job_id=job_id,
                        status="submitted",
                        notes="Application submitted via Indeed",
                        screenshot_path=str(post_screenshot) if post_screenshot else None,
                    )
                    self.daily_count += 1
                    if company_key:
                        self.company_counts[company_key] = (
                            self.company_counts.get(company_key, 0) + 1
                        )
                    return "submitted"
                else:
                    self._record_attempt(
                        job_id=job_id,
                        status="failed",
                        notes="Submit button not found on review page",
                    )
                    return "failed"

            # --- Try to advance to the next page ---
            advanced = await self._click_continue(page)
            if not advanced:
                # If we can't continue and aren't on the review page,
                # check whether application was already submitted
                # (some flows auto-submit after last question page).
                if await self._detected_confirmation(page):
                    post_screenshot = await self._screenshot(
                        page, item_id, "auto_submitted"
                    )
                    logger.info("Indeed auto-submitted application for '%s'", job_title)
                    self._record_attempt(
                        job_id=job_id,
                        status="submitted",
                        notes="Auto-submitted (no review page)",
                        screenshot_path=str(post_screenshot) if post_screenshot else None,
                    )
                    self.daily_count += 1
                    if company_key:
                        self.company_counts[company_key] = (
                            self.company_counts.get(company_key, 0) + 1
                        )
                    return "submitted"

                logger.warning(
                    "Cannot advance form for '%s' (page %d)",
                    job_title,
                    page_num + 1,
                )
                await self._screenshot(page, item_id, "stuck")
                self._record_attempt(
                    job_id=job_id,
                    status="failed",
                    notes=f"Stuck on form page {page_num + 1}",
                )
                return "failed"

        # Exhausted max pages
        logger.error("Exceeded max form pages for '%s'", job_title)
        self._record_attempt(
            job_id=job_id,
            status="failed",
            notes="Exceeded max form pages",
        )
        return "failed"

    # ------------------------------------------------------------------
    # Resume upload
    # ------------------------------------------------------------------

    async def _page_has_resume_upload(self, page: Page) -> bool:
        """Check whether the current page has a resume file input."""
        selectors = [
            "input[type='file'][name*='resume' i]",
            "input[type='file'][id*='resume' i]",
            "input[type='file'][accept*='.pdf']",
            "input[type='file']",
        ]
        for sel in selectors:
            try:
                el = page.locator(sel).first
                if await el.count() > 0:
                    return True
            except Exception:
                continue
        return False

    async def _handle_resume_upload(self, page: Page) -> None:
        """Upload the candidate's resume file if a file input is present."""
        if not self.resume_path or not Path(self.resume_path).exists():
            logger.warning(
                "Resume path not set or file missing: %s", self.resume_path
            )
            return

        selectors = [
            "input[type='file'][name*='resume' i]",
            "input[type='file'][id*='resume' i]",
            "input[type='file'][accept*='.pdf']",
            "input[type='file']",
        ]
        for sel in selectors:
            try:
                el = page.locator(sel).first
                if await el.count() > 0:
                    await el.set_input_files(self.resume_path)
                    logger.info("Uploaded resume: %s", self.resume_path)
                    await page.wait_for_timeout(2000)
                    return
            except Exception:
                continue

        logger.warning("Could not locate file input for resume upload.")

    # ------------------------------------------------------------------
    # Contact info
    # ------------------------------------------------------------------

    async def _page_has_contact_fields(self, page: Page) -> bool:
        """Check whether the page has typical contact-info fields."""
        indicators = [
            "input[name*='firstName' i]",
            "input[name*='first_name' i]",
            "input[name*='email' i]",
            "input[type='email']",
            "input[name*='phone' i]",
            "input[type='tel']",
        ]
        for sel in indicators:
            try:
                if await page.locator(sel).first.count() > 0:
                    return True
            except Exception:
                continue
        return False

    async def _fill_contact_info(self, page: Page) -> None:
        """Fill contact-info fields from the user profile."""
        profile = self._user_profile or {}

        field_map: list[tuple[str, list[str]]] = [
            (
                profile.get("first_name", ""),
                [
                    "input[name*='firstName' i]",
                    "input[name*='first_name' i]",
                    "input[id*='firstName' i]",
                    "input[id*='first-name' i]",
                ],
            ),
            (
                profile.get("last_name", ""),
                [
                    "input[name*='lastName' i]",
                    "input[name*='last_name' i]",
                    "input[id*='lastName' i]",
                    "input[id*='last-name' i]",
                ],
            ),
            (
                profile.get("email", ""),
                [
                    "input[type='email']",
                    "input[name*='email' i]",
                    "input[id*='email' i]",
                ],
            ),
            (
                profile.get("phone", ""),
                [
                    "input[type='tel']",
                    "input[name*='phone' i]",
                    "input[id*='phone' i]",
                ],
            ),
            (
                profile.get("city", ""),
                [
                    "input[name*='city' i]",
                    "input[id*='city' i]",
                ],
            ),
            (
                profile.get("state", ""),
                [
                    "input[name*='state' i]",
                    "input[id*='state' i]",
                ],
            ),
        ]

        for value, selectors in field_map:
            if not value:
                continue
            for sel in selectors:
                try:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=1000):
                        # Clear and type rather than fill to trigger change events
                        await el.click()
                        await el.fill("")
                        await el.type(str(value), delay=30)
                        logger.debug("Filled contact field: %s", sel)
                        break
                except Exception:
                    continue

    # ------------------------------------------------------------------
    # Screening questions
    # ------------------------------------------------------------------

    async def _page_has_screening_questions(self, page: Page) -> bool:
        """Detect whether the current page has screening-question fields."""
        # Indeed wraps screening questions in fieldsets or divs with
        # specific data attributes or class names.
        indicators = [
            "[data-testid='screener-question']",
            ".ia-Questions",
            ".ia-BasePage-heading:has-text('questions')",
            "fieldset legend",
            "label:has-text('experience')",
            "label:has-text('authorization')",
            "label:has-text('years')",
        ]
        for sel in indicators:
            try:
                if await page.locator(sel).first.count() > 0:
                    return True
            except Exception:
                continue
        return False

    async def _handle_screening_questions(
        self,
        page: Page,
        item: dict[str, Any],
    ) -> None:
        """
        Detect screening-question fields on the page, call Claude AI to
        generate answers, and fill them in.
        """
        questions = await self._extract_questions(page)
        if not questions:
            return

        job_context = (
            f"Job title: {item.get('job_title', '')}\n"
            f"Company: {item.get('company', '')}\n"
        )

        answers = self.ai.answer_screening_questions(
            questions=questions,
            resume_data=self._resume_data or {},
            user_profile=self._user_profile or {},
            job_context=job_context,
        )

        for q, a in zip(questions, answers):
            answer_text = a.get("answer", "")
            if not answer_text:
                continue

            locator = q.get("_locator")
            field_type = q.get("field_type", "text")

            try:
                if field_type in ("select", "dropdown"):
                    await self._select_option(page, locator, answer_text)
                elif field_type == "radio":
                    await self._select_radio(page, q, answer_text)
                elif field_type == "checkbox":
                    await self._toggle_checkbox(page, q, answer_text)
                else:
                    # text / textarea
                    if locator:
                        await locator.click()
                        await locator.fill("")
                        await locator.type(str(answer_text), delay=30)
                logger.debug(
                    "Answered question '%s' with '%s'",
                    q.get("question", "")[:60],
                    str(answer_text)[:60],
                )
            except Exception as exc:
                logger.warning(
                    "Could not fill answer for '%s': %s",
                    q.get("question", "")[:60],
                    exc,
                )

    async def _extract_questions(self, page: Page) -> list[dict[str, Any]]:
        """
        Scrape visible screening-question fields from the page.

        Returns a list of dicts with ``question``, ``field_type``,
        ``options``, and ``_locator`` (Playwright locator for the input).
        """
        questions: list[dict[str, Any]] = []

        # Strategy 1: fieldsets with legends
        fieldsets = page.locator("fieldset")
        fieldset_count = await fieldsets.count()
        for i in range(fieldset_count):
            fs = fieldsets.nth(i)
            try:
                legend = fs.locator("legend").first
                q_text = (await legend.inner_text()).strip() if await legend.count() > 0 else ""
                if not q_text:
                    # Try label
                    label = fs.locator("label").first
                    q_text = (await label.inner_text()).strip() if await label.count() > 0 else ""
                if not q_text:
                    continue

                # Determine field type
                entry = await self._identify_field(fs, q_text)
                if entry:
                    questions.append(entry)
            except Exception:
                continue

        # Strategy 2: labelled inputs outside fieldsets (if nothing found)
        if not questions:
            labels = page.locator("label")
            label_count = await labels.count()
            for i in range(label_count):
                lbl = labels.nth(i)
                try:
                    q_text = (await lbl.inner_text()).strip()
                    if not q_text or len(q_text) < 5:
                        continue
                    for_attr = await lbl.get_attribute("for")
                    if for_attr:
                        inp = page.locator(f"#{for_attr}").first
                    else:
                        inp = lbl.locator(".. >> input, .. >> textarea, .. >> select").first
                    if await inp.count() == 0:
                        continue
                    entry = await self._identify_field_from_input(inp, q_text)
                    if entry:
                        questions.append(entry)
                except Exception:
                    continue

        logger.info("Extracted %d screening questions.", len(questions))
        return questions

    async def _identify_field(
        self,
        container: Any,
        question_text: str,
    ) -> dict[str, Any] | None:
        """Identify the field type inside a fieldset/container."""
        # Check for select
        select = container.locator("select").first
        if await select.count() > 0:
            options = await self._get_select_options(select)
            return {
                "question": question_text,
                "field_type": "select",
                "options": options,
                "_locator": select,
            }

        # Check for radio buttons
        radios = container.locator("input[type='radio']")
        if await radios.count() > 0:
            options = await self._get_radio_options(container)
            return {
                "question": question_text,
                "field_type": "radio",
                "options": options,
                "_locator": container,  # parent container
            }

        # Check for checkboxes
        checkboxes = container.locator("input[type='checkbox']")
        if await checkboxes.count() > 0:
            options = await self._get_checkbox_labels(container)
            return {
                "question": question_text,
                "field_type": "checkbox",
                "options": options,
                "_locator": container,
            }

        # Textarea
        textarea = container.locator("textarea").first
        if await textarea.count() > 0:
            return {
                "question": question_text,
                "field_type": "textarea",
                "options": [],
                "_locator": textarea,
            }

        # Text input
        text_input = container.locator("input[type='text'], input[type='number'], input:not([type])").first
        if await text_input.count() > 0:
            return {
                "question": question_text,
                "field_type": "text",
                "options": [],
                "_locator": text_input,
            }

        return None

    async def _identify_field_from_input(
        self,
        inp: Any,
        question_text: str,
    ) -> dict[str, Any] | None:
        """Identify field type from a direct input element."""
        tag = await inp.evaluate("el => el.tagName.toLowerCase()")
        input_type = (await inp.get_attribute("type") or "text").lower()

        if tag == "select":
            options = await self._get_select_options(inp)
            return {
                "question": question_text,
                "field_type": "select",
                "options": options,
                "_locator": inp,
            }
        elif tag == "textarea":
            return {
                "question": question_text,
                "field_type": "textarea",
                "options": [],
                "_locator": inp,
            }
        elif input_type in ("text", "number", ""):
            return {
                "question": question_text,
                "field_type": "text",
                "options": [],
                "_locator": inp,
            }

        return None

    # ------------------------------------------------------------------
    # Helpers for select / radio / checkbox
    # ------------------------------------------------------------------

    @staticmethod
    async def _get_select_options(select_locator: Any) -> list[str]:
        """Extract all <option> text values from a <select>."""
        options: list[str] = []
        option_els = select_locator.locator("option")
        count = await option_els.count()
        for i in range(count):
            text = (await option_els.nth(i).inner_text()).strip()
            value = await option_els.nth(i).get_attribute("value")
            # Skip placeholder / empty options
            if text and value not in (None, "", "--"):
                options.append(text)
        return options

    @staticmethod
    async def _get_radio_options(container: Any) -> list[str]:
        """Extract label text for each radio option in a container."""
        options: list[str] = []
        labels = container.locator("label")
        count = await labels.count()
        for i in range(count):
            text = (await labels.nth(i).inner_text()).strip()
            if text:
                options.append(text)
        return options

    @staticmethod
    async def _get_checkbox_labels(container: Any) -> list[str]:
        """Extract label text for each checkbox in a container."""
        options: list[str] = []
        labels = container.locator("label")
        count = await labels.count()
        for i in range(count):
            text = (await labels.nth(i).inner_text()).strip()
            if text:
                options.append(text)
        return options

    @staticmethod
    async def _select_option(
        page: Page,
        locator: Any,
        answer: str,
    ) -> None:
        """Select an <option> from a <select> that best matches *answer*."""
        # Try exact match first
        try:
            await locator.select_option(label=answer)
            return
        except Exception:
            pass

        # Fall back to case-insensitive substring match
        options_els = locator.locator("option")
        count = await options_els.count()
        answer_lower = answer.lower()
        for i in range(count):
            text = (await options_els.nth(i).inner_text()).strip()
            if text.lower() == answer_lower or answer_lower in text.lower():
                value = await options_els.nth(i).get_attribute("value")
                if value is not None:
                    await locator.select_option(value=value)
                    return

        logger.warning("Could not match select option for answer: %s", answer)

    @staticmethod
    async def _select_radio(
        page: Page,
        question: dict[str, Any],
        answer: str,
    ) -> None:
        """Click the radio button whose label matches *answer*."""
        container = question.get("_locator")
        if not container:
            return
        labels = container.locator("label")
        count = await labels.count()
        answer_lower = answer.lower()
        for i in range(count):
            text = (await labels.nth(i).inner_text()).strip()
            if text.lower() == answer_lower or answer_lower in text.lower():
                await labels.nth(i).click()
                return
        logger.warning("Could not match radio option for answer: %s", answer)

    @staticmethod
    async def _toggle_checkbox(
        page: Page,
        question: dict[str, Any],
        answer: str,
    ) -> None:
        """Check checkboxes matching *answer* (comma-separated labels)."""
        container = question.get("_locator")
        if not container:
            return
        desired = {a.strip().lower() for a in answer.split(",")}
        labels = container.locator("label")
        count = await labels.count()
        for i in range(count):
            text = (await labels.nth(i).inner_text()).strip()
            if text.lower() in desired:
                await labels.nth(i).click()

    # ------------------------------------------------------------------
    # Navigation helpers
    # ------------------------------------------------------------------

    async def _is_review_page(self, page: Page) -> bool:
        """Check if the current page is the final review/submit page."""
        indicators = [
            "button:has-text('Submit your application')",
            "button:has-text('Submit application')",
            "button:has-text('Submit')",
            "[data-testid='submit-button']",
            ".ia-ReviewPage",
            "h1:has-text('Review')",
            "h2:has-text('Review your application')",
        ]
        for sel in indicators:
            try:
                if await page.locator(sel).first.is_visible(timeout=1000):
                    return True
            except Exception:
                continue
        return False

    async def _click_continue(self, page: Page) -> bool:
        """
        Click the 'Continue' / 'Next' button to advance the form.

        Returns True if a button was clicked successfully.
        """
        selectors = [
            "button:has-text('Continue')",
            "button:has-text('Next')",
            "[data-testid='continue-button']",
            "button[type='button']:has-text('Continue')",
            "button.ia-continueButton",
        ]
        for sel in selectors:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    await page.wait_for_timeout(2000)
                    return True
            except Exception:
                continue
        return False

    async def _click_submit(self, page: Page) -> bool:
        """
        Click the final submit button on the review page.

        Returns True if a submit button was found and clicked.
        """
        selectors = [
            "button:has-text('Submit your application')",
            "button:has-text('Submit application')",
            "button:has-text('Submit')",
            "[data-testid='submit-button']",
            "button[type='submit']",
        ]
        for sel in selectors:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    await page.wait_for_timeout(5000)
                    return True
            except Exception:
                continue
        return False

    async def _detected_confirmation(self, page: Page) -> bool:
        """Check whether the page shows a 'your application has been submitted' message."""
        indicators = [
            "text='Your application has been submitted'",
            "text='Application submitted'",
            "h1:has-text('submitted')",
            ".ia-PostApply",
            "[data-testid='post-apply']",
        ]
        for sel in indicators:
            try:
                if await page.locator(sel).first.is_visible(timeout=2000):
                    return True
            except Exception:
                continue
        return False

    # ------------------------------------------------------------------
    # Screenshots
    # ------------------------------------------------------------------

    async def _screenshot(
        self,
        page: Page,
        item_id: str,
        label: str,
    ) -> Path | None:
        """Take a full-page screenshot and return the file path."""
        try:
            ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            path = SCREENSHOTS_DIR / f"indeed_{item_id}_{label}_{ts}.png"
            await page.screenshot(path=str(path), full_page=True)
            logger.info("Screenshot saved: %s", path)
            return path
        except Exception as exc:
            logger.warning("Failed to take screenshot: %s", exc)
            return None

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    def _record_attempt(
        self,
        job_id: str | None,
        status: str,
        notes: str = "",
        error_message: str = "",
        screenshot_path: str | None = None,
    ) -> None:
        """Insert a row into the application_attempts table."""
        data: dict[str, Any] = {
            "platform": "indeed",
            "status": status,
        }
        if job_id:
            data["job_id"] = job_id
        if notes:
            data["notes"] = notes
        if error_message:
            data["error_message"] = error_message
        if screenshot_path:
            data["screenshot_path"] = screenshot_path
        if status == "submitted":
            data["applied_at"] = datetime.utcnow().isoformat()

        try:
            self.db.insert_application_attempt(data)
        except Exception as exc:
            logger.error("Failed to record application attempt: %s", exc)

    # ------------------------------------------------------------------
    # Misc
    # ------------------------------------------------------------------

    @staticmethod
    def _user_agent() -> str:
        return (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )


# ------------------------------------------------------------------
# Convenience synchronous wrapper
# ------------------------------------------------------------------


def run_indeed_applier(
    job_items: list[dict[str, Any]],
    dry_run: bool = True,
    max_daily: int = 10,
    max_per_company_per_week: int = 1,
    resume_path: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper to run the async IndeedApplier."""
    applier = IndeedApplier(
        dry_run=dry_run,
        max_daily=max_daily,
        max_per_company_per_week=max_per_company_per_week,
        resume_path=resume_path,
    )
    return asyncio.run(applier.run(job_items))
