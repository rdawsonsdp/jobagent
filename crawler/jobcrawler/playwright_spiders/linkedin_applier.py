"""
LinkedIn Easy Apply automation module.

Handles the multi-step Easy Apply modal flow on LinkedIn:
  1. Session management (load/save browser state from Supabase)
  2. Navigation to job URL and clicking Easy Apply
  3. Multi-step form handling (contact info, resume upload, screening questions)
  4. AI-powered screening question answers via Claude
  5. Screenshot capture at each step for debugging

Safety guardrails:
  - dry_run mode is default True
  - Max 10 applications per day
  - Max 1 application per company per week
  - Screenshots taken at every step and before submit
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
    Playwright,
    TimeoutError as PlaywrightTimeout,
)

from jobcrawler.ai.claude_client import ClaudeClient
from jobcrawler.db.supabase_client import SupabaseDB

logger = logging.getLogger(__name__)

# Directory for application screenshots
SCREENSHOTS_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "screenshots"

# Maximum number of "Next" steps before we assume the flow is stuck
MAX_MODAL_STEPS = 12

# Timeout for waiting on modal transitions (ms)
MODAL_TRANSITION_MS = 2000

# Timeout for page navigation (ms)
NAV_TIMEOUT_MS = 30_000


class LinkedInApplier:
    """
    Playwright-based LinkedIn Easy Apply automation.

    Loads a persistent LinkedIn session from Supabase, navigates to job URLs,
    and walks through the Easy Apply multi-step modal.  Screening questions
    are answered using Claude AI with resume + user profile context.

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
    ) -> None:
        self.dry_run = dry_run
        self.max_daily = max_daily
        self.max_per_company_per_week = max_per_company_per_week

        self.db = SupabaseDB()
        self.claude = ClaudeClient()

        self.daily_count = 0
        self.company_counts: dict[str, int] = {}

        # Lazily populated
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._user_profile: dict[str, Any] | None = None
        self._resume: dict[str, Any] | None = None

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def run(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Process a list of job items through LinkedIn Easy Apply.

        Each item should have at minimum:
            - id: str
            - job_url: str (LinkedIn job URL)
            - job_title: str
            - company: str

        Returns a summary dict with counts of processed, submitted,
        skipped, and failed applications.
        """
        summary: dict[str, Any] = {
            "processed": 0,
            "submitted": 0,
            "skipped": 0,
            "failed": 0,
            "dry_run": self.dry_run,
        }

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

        if not items:
            logger.info("No items to process.")
            return summary

        logger.info(
            "LinkedInApplier: %d items to process (dry_run=%s)",
            len(items),
            self.dry_run,
        )

        # Pre-load user profile and resume so we fail fast if missing
        self._user_profile = self.db.get_user_profile()
        if not self._user_profile:
            logger.error("No user profile found. Cannot proceed.")
            return summary

        self._resume = self.db.get_active_resume()
        if not self._resume:
            logger.error("No active resume found. Cannot proceed.")
            return summary

        # Load recent application history for guardrail checks
        self._load_application_history()

        self._playwright = await async_playwright().start()

        try:
            await self._ensure_session()

            for item in items:
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
            if self._context:
                # Persist session state before closing
                try:
                    storage = await self._context.storage_state()
                    self.db.save_browser_session("linkedin", storage)
                    logger.info("LinkedIn session state saved.")
                except Exception as exc:
                    logger.warning("Could not save session state: %s", exc)

                await self._context.close()
            if self._browser:
                await self._browser.close()
            if self._playwright:
                await self._playwright.stop()

        logger.info("LinkedInApplier summary: %s", summary)
        return summary

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    async def _ensure_session(self) -> None:
        """
        Ensure we have a valid LinkedIn browser session.

        1. Try to load storage_state from Supabase (browser_sessions).
        2. Launch a browser context with that state.
        3. Validate the session by navigating to LinkedIn and checking
           for a login-page redirect.
        4. If invalid, open a VISIBLE browser and wait for the user to
           log in manually, then save the new state.
        """
        assert self._playwright is not None

        session = self.db.get_browser_session("linkedin")
        storage_state: dict[str, Any] | None = None

        if session:
            raw = session.get("storage_state")
            if isinstance(raw, dict):
                storage_state = raw
            elif isinstance(raw, str):
                try:
                    storage_state = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    storage_state = None

        # Attempt headless launch with existing session
        if storage_state:
            logger.info("Found existing LinkedIn session -- validating...")
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )
            self._context = await self._browser.new_context(
                storage_state=storage_state,
                viewport={"width": 1280, "height": 900},
                user_agent=_user_agent(),
            )

            if await self._session_is_valid():
                logger.info("LinkedIn session is valid.")
                return

            # Session expired -- tear down and fall through to manual login
            logger.warning("LinkedIn session expired. Requesting manual login.")
            await self._context.close()
            await self._browser.close()
            self._context = None
            self._browser = None

        # Manual login flow -- launch VISIBLE browser
        await self._manual_login_flow()

    async def _session_is_valid(self) -> bool:
        """
        Navigate to LinkedIn feed and check whether we are still logged in.

        Returns True if the session is valid (no redirect to login page).
        """
        assert self._context is not None

        page = await self._context.new_page()
        try:
            await page.goto(
                "https://www.linkedin.com/feed/",
                wait_until="domcontentloaded",
                timeout=NAV_TIMEOUT_MS,
            )
            await page.wait_for_timeout(2000)

            current_url = page.url
            # If we ended up on login/authwall, session is invalid
            if "/login" in current_url or "/authwall" in current_url or "signin" in current_url:
                return False

            # Extra check: look for the feed content or nav elements
            try:
                await page.wait_for_selector(
                    "div.feed-shared-update-v2, nav.global-nav, #global-nav",
                    timeout=5000,
                )
                return True
            except PlaywrightTimeout:
                # If no feed content found, probably not logged in
                return False
        except Exception as exc:
            logger.warning("Session validation error: %s", exc)
            return False
        finally:
            await page.close()

    async def _manual_login_flow(self) -> None:
        """
        Open a visible browser window to LinkedIn login and wait for the
        user to complete authentication.  Once logged in, save the
        storage_state to Supabase.
        """
        assert self._playwright is not None

        logger.info(
            "Opening visible browser for LinkedIn login. "
            "Please log in manually within the browser window."
        )

        self._browser = await self._playwright.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=_user_agent(),
        )

        page = await self._context.new_page()
        await page.goto(
            "https://www.linkedin.com/login",
            wait_until="domcontentloaded",
            timeout=NAV_TIMEOUT_MS,
        )

        # Poll until we see the feed (user has logged in)
        logger.info("Waiting for manual login (up to 5 minutes)...")
        deadline = asyncio.get_event_loop().time() + 300  # 5 minutes
        logged_in = False

        while asyncio.get_event_loop().time() < deadline:
            await page.wait_for_timeout(3000)
            current_url = page.url
            if (
                "/feed" in current_url
                or "/mynetwork" in current_url
                or "/jobs" in current_url
                or "/messaging" in current_url
            ):
                logged_in = True
                break

        await page.close()

        if not logged_in:
            raise RuntimeError(
                "LinkedIn manual login timed out after 5 minutes. "
                "Please try again."
            )

        # Save session
        storage = await self._context.storage_state()
        self.db.save_browser_session("linkedin", storage)
        logger.info("LinkedIn session saved successfully after manual login.")

    # ------------------------------------------------------------------
    # Application history / guardrails
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
    # Per-item processing
    # ------------------------------------------------------------------

    async def _process_item(self, item: dict[str, Any]) -> str:
        """
        Process a single Easy Apply item.

        Returns: "submitted", "skipped", or "failed".
        """
        item_id = item.get("id", "unknown")
        job_url = item.get("job_url", "")
        company = (item.get("company") or "").strip()
        job_title = item.get("job_title", "")

        logger.info(
            "Processing LinkedIn Easy Apply #%s: '%s' at '%s'",
            item_id, job_title, company,
        )

        # Guardrail: company-per-week limit
        company_key = company.lower()
        if company_key and self.company_counts.get(company_key, 0) >= self.max_per_company_per_week:
            logger.info(
                "Skipping '%s' at '%s' -- company weekly limit reached.",
                job_title, company,
            )
            self._log_attempt(item_id, "skipped", notes="Company weekly limit reached")
            return "skipped"

        if not job_url:
            logger.warning("Item #%s has no job_url.", item_id)
            self._log_attempt(item_id, "failed", notes="No job URL")
            return "failed"

        assert self._context is not None
        page = await self._context.new_page()

        try:
            # --- Navigate to job page ---
            await page.goto(job_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            await page.wait_for_timeout(2000)
            await self._take_screenshot(page, item_id, "01_job_page")

            # --- Find and click Easy Apply button ---
            easy_apply_btn = await self._find_easy_apply_button(page)
            if not easy_apply_btn:
                logger.warning("No Easy Apply button found for '%s'.", job_title)
                await self._take_screenshot(page, item_id, "01_no_easy_apply")
                self._log_attempt(item_id, "failed", notes="Easy Apply button not found")
                return "failed"

            await easy_apply_btn.click()
            await page.wait_for_timeout(MODAL_TRANSITION_MS)
            await self._take_screenshot(page, item_id, "02_modal_opened")

            # --- Walk through the multi-step modal ---
            result = await self._walk_modal_steps(page, item_id, job_title)

            if result == "submitted":
                self.daily_count += 1
                if company_key:
                    self.company_counts[company_key] = (
                        self.company_counts.get(company_key, 0) + 1
                    )

            return result

        except PlaywrightTimeout:
            logger.error("Timeout processing Easy Apply for '%s'.", job_title)
            await self._take_screenshot(page, item_id, "error_timeout")
            self._log_attempt(item_id, "failed", notes="Timeout")
            return "failed"
        except Exception as exc:
            logger.error("Error processing Easy Apply #%s: %s", item_id, exc, exc_info=True)
            await self._take_screenshot(page, item_id, "error_exception")
            self._log_attempt(item_id, "failed", notes=str(exc)[:500])
            return "failed"
        finally:
            await page.close()

    # ------------------------------------------------------------------
    # Easy Apply modal navigation
    # ------------------------------------------------------------------

    async def _walk_modal_steps(
        self,
        page: Page,
        item_id: str,
        job_title: str,
    ) -> str:
        """
        Walk through each step of the LinkedIn Easy Apply modal until we
        reach the review/submit step.

        Returns "submitted", "skipped", or "failed".
        """
        for step_num in range(1, MAX_MODAL_STEPS + 1):
            step_label = f"step_{step_num:02d}"
            logger.info("Easy Apply step %d for #%s", step_num, item_id)

            # Determine what kind of step we're on and handle it
            await self._handle_current_step(page, item_id, step_label)

            await self._take_screenshot(page, item_id, f"{step_label}_filled")

            # Check which button is available: Submit, Review, or Next
            submit_btn = await self._find_button(
                page,
                ["Submit application", "Submit"],
                exact_match=True,
            )
            if submit_btn:
                return await self._handle_submit(page, item_id, submit_btn, job_title)

            review_btn = await self._find_button(page, ["Review"])
            if review_btn:
                await review_btn.click()
                await page.wait_for_timeout(MODAL_TRANSITION_MS)
                await self._take_screenshot(page, item_id, "review_page")

                # After review, look for submit
                submit_btn = await self._find_button(
                    page,
                    ["Submit application", "Submit"],
                    exact_match=True,
                )
                if submit_btn:
                    return await self._handle_submit(page, item_id, submit_btn, job_title)

                # If no submit on review page, something is unexpected
                logger.warning("No submit button found on review page for #%s.", item_id)
                self._log_attempt(item_id, "failed", notes="No submit button on review page")
                return "failed"

            next_btn = await self._find_button(page, ["Next", "Continue"])
            if next_btn:
                await next_btn.click()
                await page.wait_for_timeout(MODAL_TRANSITION_MS)
                continue

            # No recognised button -- modal might have closed or errored
            logger.warning(
                "No Next/Review/Submit button found at step %d for #%s.",
                step_num, item_id,
            )
            await self._take_screenshot(page, item_id, f"{step_label}_stuck")
            self._log_attempt(item_id, "failed", notes=f"Stuck at step {step_num}")
            return "failed"

        # Exceeded max steps
        logger.warning("Exceeded max modal steps (%d) for #%s.", MAX_MODAL_STEPS, item_id)
        self._log_attempt(item_id, "failed", notes="Exceeded max modal steps")
        return "failed"

    async def _handle_submit(
        self,
        page: Page,
        item_id: str,
        submit_btn: Any,
        job_title: str,
    ) -> str:
        """Handle the final submit action (or dry-run stop)."""
        await self._take_screenshot(page, item_id, "pre_submit")

        if self.dry_run:
            logger.info(
                "DRY RUN: Would submit application for '%s' (#%s).",
                job_title, item_id,
            )
            self._log_attempt(item_id, "dry_run_complete", notes="Form filled, dry run")
            return "submitted"

        await submit_btn.click()
        await page.wait_for_timeout(3000)
        await self._take_screenshot(page, item_id, "post_submit")

        # Check for confirmation (LinkedIn typically shows a confirmation dialog)
        try:
            confirmation = page.locator(
                "h2:has-text('application was sent'), "
                "h3:has-text('application was sent'), "
                "div:has-text('Application submitted'), "
                "div:has-text('Your application was sent')"
            ).first
            await confirmation.wait_for(timeout=5000)
            logger.info("Confirmation detected for #%s.", item_id)
        except PlaywrightTimeout:
            logger.warning("No submission confirmation detected for #%s.", item_id)

        self._log_attempt(item_id, "submitted", notes="Application submitted")
        return "submitted"

    # ------------------------------------------------------------------
    # Step handlers
    # ------------------------------------------------------------------

    async def _handle_current_step(
        self,
        page: Page,
        item_id: str,
        step_label: str,
    ) -> None:
        """
        Inspect the current modal step and fill in fields appropriately.

        Handles:
          - Contact info fields (name, email, phone)
          - Resume upload
          - Additional/screening questions
        """
        modal = page.locator(
            "div.jobs-easy-apply-modal, "
            "div.jobs-easy-apply-content, "
            "div[data-test-modal], "
            "div.artdeco-modal"
        ).first

        # --- Contact info fields ---
        await self._fill_contact_info(page)

        # --- Resume upload ---
        await self._handle_resume_upload(page, item_id)

        # --- Screening / additional questions ---
        await self._handle_screening_questions(page, item_id)

    async def _fill_contact_info(self, page: Page) -> None:
        """
        Fill contact information fields if they are present and empty.

        Pulls values from user_profile.
        """
        assert self._user_profile is not None

        contact_fields = {
            "first_name": {
                "value": self._user_profile.get("first_name", ""),
                "selectors": [
                    "input[id*='first' i]",
                    "input[name*='first' i]",
                    "input[aria-label*='First' i]",
                ],
            },
            "last_name": {
                "value": self._user_profile.get("last_name", ""),
                "selectors": [
                    "input[id*='last' i]",
                    "input[name*='last' i]",
                    "input[aria-label*='Last' i]",
                ],
            },
            "email": {
                "value": self._user_profile.get("email", ""),
                "selectors": [
                    "input[type='email']",
                    "input[id*='email' i]",
                    "input[name*='email' i]",
                    "input[aria-label*='Email' i]",
                ],
            },
            "phone": {
                "value": self._user_profile.get("phone", ""),
                "selectors": [
                    "input[type='tel']",
                    "input[id*='phone' i]",
                    "input[name*='phone' i]",
                    "input[aria-label*='Phone' i]",
                ],
            },
            "city": {
                "value": self._user_profile.get("city", ""),
                "selectors": [
                    "input[id*='city' i]",
                    "input[name*='city' i]",
                    "input[aria-label*='City' i]",
                ],
            },
        }

        for field_name, config in contact_fields.items():
            value = config["value"]
            if not value:
                continue
            for selector in config["selectors"]:
                try:
                    element = page.locator(selector).first
                    if await element.is_visible(timeout=500):
                        current_val = await element.input_value()
                        if not current_val.strip():
                            await element.fill(str(value))
                            logger.debug("Filled contact field '%s'.", field_name)
                        break
                except Exception:
                    continue

    async def _handle_resume_upload(self, page: Page, item_id: str) -> None:
        """
        Upload a resume file if a file input is present on the current step.

        The resume file path comes from the active resume record in Supabase.
        """
        assert self._resume is not None

        file_path = self._resume.get("file_path", "")
        if not file_path:
            logger.debug("No resume file_path set in active resume.")
            return

        # Resolve path
        resume_path = Path(file_path)
        if not resume_path.is_absolute():
            # Assume relative to crawler root
            resume_path = (
                Path(__file__).resolve().parent.parent.parent / file_path
            )

        if not resume_path.exists():
            logger.warning("Resume file not found at %s.", resume_path)
            return

        # LinkedIn uses a file input inside the resume section
        file_input_selectors = [
            "input[type='file'][name*='resume' i]",
            "input[type='file'][id*='resume' i]",
            "input[type='file']",
        ]

        for selector in file_input_selectors:
            try:
                file_input = page.locator(selector).first
                # File inputs are typically hidden, so don't check visibility
                if await file_input.count() > 0:
                    await file_input.set_input_files(str(resume_path))
                    logger.info("Uploaded resume: %s", resume_path.name)
                    await page.wait_for_timeout(1000)
                    return
            except Exception:
                continue

    async def _handle_screening_questions(
        self,
        page: Page,
        item_id: str,
    ) -> None:
        """
        Detect and answer screening / additional questions on the
        current modal step.

        1. Extract all visible form fields (text, select, radio, checkbox).
        2. Send question text + field type to Claude for AI-generated answers.
        3. Fill in the answers.
        """
        questions = await self._extract_form_fields(page)

        if not questions:
            return

        logger.info(
            "Found %d screening question(s) for #%s.",
            len(questions), item_id,
        )

        # Try to answer from screening_defaults first, then fall back to AI
        answers = self._answer_from_defaults(questions)

        # Collect unanswered questions that need AI
        unanswered = [q for q in questions if q["id"] not in answers]

        if unanswered:
            ai_answers = self._get_ai_answers(unanswered)
            answers.update(ai_answers)

        # Fill in answers
        for question in questions:
            qid = question["id"]
            answer = answers.get(qid)
            if answer is None:
                logger.warning("No answer for question: %s", question["label"])
                continue

            await self._fill_answer(page, question, answer)

    async def _extract_form_fields(self, page: Page) -> list[dict[str, Any]]:
        """
        Extract all visible form fields from the current modal step.

        Returns a list of dicts with:
            - id: unique identifier (element id or generated)
            - label: the question / label text
            - field_type: "text" | "textarea" | "select" | "radio" | "checkbox"
            - options: list of option values (for select/radio/checkbox)
            - selector: CSS selector to target the element
        """
        fields: list[dict[str, Any]] = []

        # Strategy: find form groups within the modal.  LinkedIn wraps each
        # question in a fieldset or div with a label.
        form_groups = page.locator(
            "div.jobs-easy-apply-modal div.fb-dash-form-element, "
            "div.jobs-easy-apply-content div.fb-dash-form-element, "
            "div.artdeco-modal div.fb-dash-form-element, "
            "div.jobs-easy-apply-modal fieldset, "
            "div.jobs-easy-apply-content fieldset, "
            "div.artdeco-modal fieldset, "
            "div.jobs-easy-apply-modal div[data-test-form-element], "
            "div.jobs-easy-apply-content div[data-test-form-element]"
        )

        count = await form_groups.count()

        for i in range(count):
            group = form_groups.nth(i)

            try:
                if not await group.is_visible(timeout=300):
                    continue
            except Exception:
                continue

            # Extract label text
            label_text = ""
            for label_sel in ["label", "legend", "span.fb-dash-form-element__label"]:
                try:
                    label_el = group.locator(label_sel).first
                    if await label_el.is_visible(timeout=300):
                        label_text = (await label_el.inner_text()).strip()
                        if label_text:
                            break
                except Exception:
                    continue

            if not label_text:
                continue

            # Detect field type
            field_info = await self._detect_field_type(group, i)
            if not field_info:
                continue

            field_info["label"] = label_text
            fields.append(field_info)

        return fields

    async def _detect_field_type(
        self,
        group: Any,
        index: int,
    ) -> dict[str, Any] | None:
        """Detect the type of form field within a form group element."""
        # Text input
        try:
            text_input = group.locator("input[type='text'], input[type='number'], input[type='url']").first
            if await text_input.is_visible(timeout=300):
                el_id = await text_input.get_attribute("id") or f"text_{index}"
                return {
                    "id": el_id,
                    "field_type": "text",
                    "options": [],
                    "selector": f"#{el_id}" if await text_input.get_attribute("id") else None,
                    "_locator": text_input,
                }
        except Exception:
            pass

        # Textarea
        try:
            textarea = group.locator("textarea").first
            if await textarea.is_visible(timeout=300):
                el_id = await textarea.get_attribute("id") or f"textarea_{index}"
                return {
                    "id": el_id,
                    "field_type": "textarea",
                    "options": [],
                    "selector": f"#{el_id}" if await textarea.get_attribute("id") else None,
                    "_locator": textarea,
                }
        except Exception:
            pass

        # Select dropdown
        try:
            select = group.locator("select").first
            if await select.is_visible(timeout=300):
                el_id = await select.get_attribute("id") or f"select_{index}"
                # Extract options
                option_els = select.locator("option")
                option_count = await option_els.count()
                options = []
                for j in range(option_count):
                    opt_text = (await option_els.nth(j).inner_text()).strip()
                    opt_val = await option_els.nth(j).get_attribute("value") or opt_text
                    if opt_text and opt_text.lower() not in ("select an option", "-- select --", ""):
                        options.append({"text": opt_text, "value": opt_val})
                return {
                    "id": el_id,
                    "field_type": "select",
                    "options": options,
                    "selector": f"#{el_id}" if await select.get_attribute("id") else None,
                    "_locator": select,
                }
        except Exception:
            pass

        # Radio buttons
        try:
            radios = group.locator("input[type='radio']")
            radio_count = await radios.count()
            if radio_count > 0:
                el_name = await radios.first.get_attribute("name") or f"radio_{index}"
                options = []
                for j in range(radio_count):
                    radio = radios.nth(j)
                    radio_id = await radio.get_attribute("id") or ""
                    # Find adjacent label
                    opt_label = ""
                    if radio_id:
                        try:
                            lbl = group.locator(f"label[for='{radio_id}']").first
                            opt_label = (await lbl.inner_text()).strip()
                        except Exception:
                            pass
                    if not opt_label:
                        try:
                            parent_label = radio.locator("xpath=..").first
                            opt_label = (await parent_label.inner_text()).strip()
                        except Exception:
                            pass
                    opt_value = await radio.get_attribute("value") or opt_label
                    options.append({
                        "text": opt_label or opt_value,
                        "value": opt_value,
                        "radio_id": radio_id,
                    })
                return {
                    "id": el_name,
                    "field_type": "radio",
                    "options": options,
                    "selector": None,
                    "_locator": radios,
                }
        except Exception:
            pass

        # Checkboxes
        try:
            checkboxes = group.locator("input[type='checkbox']")
            cb_count = await checkboxes.count()
            if cb_count > 0:
                el_name = await checkboxes.first.get_attribute("name") or f"checkbox_{index}"
                options = []
                for j in range(cb_count):
                    cb = checkboxes.nth(j)
                    cb_id = await cb.get_attribute("id") or ""
                    opt_label = ""
                    if cb_id:
                        try:
                            lbl = group.locator(f"label[for='{cb_id}']").first
                            opt_label = (await lbl.inner_text()).strip()
                        except Exception:
                            pass
                    opt_value = await cb.get_attribute("value") or opt_label
                    options.append({
                        "text": opt_label or opt_value,
                        "value": opt_value,
                        "checkbox_id": cb_id,
                    })
                return {
                    "id": el_name,
                    "field_type": "checkbox",
                    "options": options,
                    "selector": None,
                    "_locator": checkboxes,
                }
        except Exception:
            pass

        return None

    # ------------------------------------------------------------------
    # Screening question answering
    # ------------------------------------------------------------------

    def _answer_from_defaults(
        self,
        questions: list[dict[str, Any]],
    ) -> dict[str, str]:
        """
        Try to answer questions from user_profile.screening_defaults.

        screening_defaults is expected to be a dict mapping keyword patterns
        to answers, e.g.:
            {
                "authorized to work": "Yes",
                "sponsorship": "No",
                "years of experience": "8",
                "salary": "150000",
            }

        Returns a dict mapping question id -> answer.
        """
        assert self._user_profile is not None

        defaults: dict[str, str] = self._user_profile.get("screening_defaults", {}) or {}
        if not defaults:
            return {}

        answers: dict[str, str] = {}

        for question in questions:
            label_lower = question["label"].lower()
            for keyword, answer in defaults.items():
                if keyword.lower() in label_lower:
                    answers[question["id"]] = str(answer)
                    logger.debug(
                        "Answered '%s' from screening_defaults: %s",
                        question["label"][:60], answer,
                    )
                    break

        return answers

    def _get_ai_answers(
        self,
        questions: list[dict[str, Any]],
    ) -> dict[str, str]:
        """
        Use Claude to answer screening questions based on resume data
        and user profile.

        Returns a dict mapping question id -> answer string.
        """
        assert self._resume is not None
        assert self._user_profile is not None

        resume_data = self._resume.get("parsed_data") or self._resume.get("resume_data") or {}
        profile = self._user_profile

        # Build the prompt
        questions_text = ""
        for i, q in enumerate(questions, 1):
            options_str = ""
            if q["options"]:
                opt_texts = [opt["text"] for opt in q["options"]]
                options_str = f"  Options: {', '.join(opt_texts)}"
            questions_text += (
                f"{i}. Question: {q['label']}\n"
                f"   Field type: {q['field_type']}\n"
                f"{options_str}\n"
                f"   ID: {q['id']}\n\n"
            )

        system_prompt = (
            "You are an expert job application assistant. You answer screening "
            "questions for job applications based on the candidate's resume and "
            "profile. You return ONLY valid JSON.\n\n"
            "Rules:\n"
            "- For yes/no questions, respond with exactly 'Yes' or 'No'.\n"
            "- For numeric fields (years of experience, salary), respond with a number.\n"
            "- For dropdown/radio questions, respond with the EXACT text of one of the options.\n"
            "- For checkbox questions, respond with a JSON array of the option texts to check.\n"
            "- For free-text questions, give a concise, professional answer (1-2 sentences).\n"
            "- Always be truthful based on the resume data provided.\n"
            "- If the resume doesn't contain enough info, give a reasonable professional answer."
        )

        user_prompt = (
            f"CANDIDATE PROFILE:\n"
            f"- Name: {profile.get('first_name', '')} {profile.get('last_name', '')}\n"
            f"- Email: {profile.get('email', '')}\n"
            f"- Phone: {profile.get('phone', '')}\n"
            f"- Location: {profile.get('city', '')}, {profile.get('state', '')} {profile.get('country', '')}\n"
            f"- LinkedIn: {profile.get('linkedin_url', '')}\n\n"
            f"RESUME DATA:\n{json.dumps(resume_data, indent=2, default=str)[:4000]}\n\n"
            f"SCREENING QUESTIONS:\n{questions_text}\n"
            f"Return a JSON object mapping each question ID to the answer. Example:\n"
            f'{{"question_id_1": "Yes", "question_id_2": "5", "question_id_3": "Option A"}}\n\n'
            f"Return ONLY the JSON object."
        )

        try:
            response_text = self.claude._call_api(
                system_prompt,
                user_prompt,
                max_tokens=2048,
                temperature=0.2,
            )
            parsed = ClaudeClient._parse_json_object(response_text)

            # Ensure all values are strings (or lists for checkboxes)
            answers: dict[str, str] = {}
            for qid, val in parsed.items():
                if isinstance(val, list):
                    answers[qid] = json.dumps(val)
                else:
                    answers[qid] = str(val)

            return answers

        except Exception as exc:
            logger.error("Claude screening question error: %s", exc)
            return {}

    async def _fill_answer(
        self,
        page: Page,
        question: dict[str, Any],
        answer: str,
    ) -> None:
        """Fill a single answer into the appropriate form field."""
        field_type = question["field_type"]
        locator = question.get("_locator")

        try:
            if field_type in ("text", "textarea"):
                if locator:
                    current = await locator.input_value()
                    if not current.strip():
                        await locator.fill(answer)
                        logger.debug("Filled text for '%s'.", question["label"][:40])

            elif field_type == "select":
                if locator:
                    # Try to match by visible text first, fall back to value
                    try:
                        await locator.select_option(label=answer)
                    except Exception:
                        await locator.select_option(value=answer)
                    logger.debug("Selected '%s' for '%s'.", answer, question["label"][:40])

            elif field_type == "radio":
                # Find the radio option whose text matches the answer
                for opt in question.get("options", []):
                    if opt["text"].strip().lower() == answer.strip().lower():
                        radio_id = opt.get("radio_id")
                        if radio_id:
                            await page.locator(f"#{radio_id}").check()
                        else:
                            # Click by label text
                            await page.locator(
                                f"label:has-text('{opt['text']}')"
                            ).first.click()
                        logger.debug("Selected radio '%s' for '%s'.", answer, question["label"][:40])
                        break

            elif field_type == "checkbox":
                # answer may be a JSON array string or a single value
                try:
                    to_check = json.loads(answer)
                except (json.JSONDecodeError, TypeError):
                    to_check = [answer]

                if not isinstance(to_check, list):
                    to_check = [to_check]

                for opt in question.get("options", []):
                    if opt["text"].strip().lower() in [v.strip().lower() for v in to_check]:
                        cb_id = opt.get("checkbox_id")
                        if cb_id:
                            await page.locator(f"#{cb_id}").check()
                        else:
                            await page.locator(
                                f"label:has-text('{opt['text']}')"
                            ).first.click()
                        logger.debug("Checked '%s' for '%s'.", opt["text"], question["label"][:40])

        except Exception as exc:
            logger.warning(
                "Failed to fill answer for '%s': %s",
                question["label"][:60], exc,
            )

    # ------------------------------------------------------------------
    # Button helpers
    # ------------------------------------------------------------------

    async def _find_easy_apply_button(self, page: Page) -> Any | None:
        """Locate the Easy Apply button on a LinkedIn job page."""
        selectors = [
            "button.jobs-apply-button:has-text('Easy Apply')",
            "button:has-text('Easy Apply')",
            "button[aria-label*='Easy Apply']",
            "div.jobs-apply-button--top-card button",
            "div.jobs-s-apply button",
        ]

        for selector in selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=2000):
                    return element
            except Exception:
                continue

        return None

    async def _find_button(
        self,
        page: Page,
        texts: list[str],
        exact_match: bool = False,
    ) -> Any | None:
        """
        Find a button in the modal by its text content.

        Looks within the Easy Apply modal context.
        """
        modal_prefix = (
            "div.jobs-easy-apply-modal, "
            "div.jobs-easy-apply-content, "
            "div.artdeco-modal"
        )

        for text in texts:
            # Try with modal context first
            selectors = [
                f"button:has-text('{text}')",
                f"button[aria-label*='{text}']",
            ]
            if exact_match:
                selectors.insert(0, f"button:text-is('{text}')")

            for selector in selectors:
                try:
                    # Search within modal first
                    element = page.locator(f"div.artdeco-modal {selector}").first
                    if await element.is_visible(timeout=1000):
                        return element
                except Exception:
                    pass
                try:
                    # Fall back to page-level search
                    element = page.locator(selector).first
                    if await element.is_visible(timeout=500):
                        return element
                except Exception:
                    continue

        return None

    # ------------------------------------------------------------------
    # Utility methods
    # ------------------------------------------------------------------

    async def _take_screenshot(
        self,
        page: Page,
        item_id: str,
        label: str,
    ) -> Path | None:
        """Take a screenshot and return the file path."""
        try:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            filename = f"li_{item_id}_{label}_{timestamp}.png"
            path = SCREENSHOTS_DIR / filename
            await page.screenshot(path=str(path), full_page=False)
            logger.debug("Screenshot: %s", path)
            return path
        except Exception as exc:
            logger.warning("Screenshot failed (%s): %s", label, exc)
            return None

    def _log_attempt(
        self,
        item_id: str,
        status: str,
        notes: str = "",
    ) -> None:
        """Log an application attempt to the application_attempts table."""
        try:
            self.db.insert_application_attempt({
                "auto_apply_id": item_id,
                "platform": "linkedin",
                "status": status,
                "notes": notes,
                "attempted_at": datetime.utcnow().isoformat(),
            })
        except Exception as exc:
            logger.error(
                "Failed to log application attempt for #%s: %s",
                item_id, exc,
            )

        # Also update the auto_apply_queue status
        try:
            applied_at = datetime.utcnow().isoformat() if status == "submitted" else None
            self.db.update_auto_apply_status(
                item_id,
                status=status,
                notes=notes,
                applied_at=applied_at,
            )
        except Exception as exc:
            logger.error(
                "Failed to update auto_apply_queue for #%s: %s",
                item_id, exc,
            )

    # ------------------------------------------------------------------
    # Class-level cleanup
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Explicitly close browser resources (for use outside of `run`)."""
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()


# ======================================================================
# Helpers
# ======================================================================

def _user_agent() -> str:
    """Return a realistic browser User-Agent string."""
    return (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )


def run_linkedin_applier(
    items: list[dict[str, Any]],
    dry_run: bool = True,
    max_daily: int = 10,
    max_per_company_per_week: int = 1,
) -> dict[str, Any]:
    """Synchronous wrapper to run the async LinkedInApplier."""
    applier = LinkedInApplier(
        dry_run=dry_run,
        max_daily=max_daily,
        max_per_company_per_week=max_per_company_per_week,
    )
    return asyncio.run(applier.run(items))
