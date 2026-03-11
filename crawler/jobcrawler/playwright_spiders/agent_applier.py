"""
AI-powered browser agent for job applications.

Replaces the hardcoded CSS-selector approach with a vision-based
observe-think-act loop:

  1. **Observe** -- take a screenshot and extract a simplified DOM listing
     of interactive elements on the current page.
  2. **Think** -- send the screenshot + DOM + context to Claude and ask for
     the single best next action.
  3. **Act** -- execute the action (click, type, select, upload, scroll).
  4. **Loop** -- repeat until the application is submitted, the agent
     declares failure, or the step budget is exhausted.

Session handling mirrors the existing LinkedIn/Indeed appliers: saved
Playwright ``storage_state`` is loaded from Supabase (``browser_sessions``
table) or from the local ``sessions/`` directory.  If a login is required,
a visible browser is opened for the user to authenticate manually.

Safety guardrails:
  - ``dry_run`` mode is default True (agent will stop before final submit)
  - Maximum step budget (default 25) before the agent gives up
  - 3 consecutive action failures trigger an early abort
  - Screenshots captured at every step for debugging/auditing
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from datetime import datetime
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

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCREENSHOTS_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "screenshots"
SESSIONS_DIR = Path(__file__).resolve().parent.parent.parent / "sessions"

NAV_TIMEOUT_MS = 30_000
ACTION_TIMEOUT_MS = 10_000
LOGIN_WAIT_SECONDS = 300  # 5 minutes for manual login

MAX_ELEMENTS = 50  # cap the number of interactive elements sent to Claude

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

LOGIN_URLS: dict[str, str] = {
    "linkedin": "https://www.linkedin.com/login",
    "indeed": "https://secure.indeed.com/auth",
}

# Indicators that the page is a login/auth wall
LOGIN_INDICATORS: dict[str, list[str]] = {
    "linkedin": ["/login", "/authwall", "/signin", "/checkpoint"],
    "indeed": ["secure.indeed.com/auth", "/login"],
}

AGENT_SYSTEM_PROMPT = """\
You are a job application agent. You are looking at a web page and need to apply for a job.

You can take these actions:
- {"action": "click", "element": <index>} - Click an element
- {"action": "type", "element": <index>, "text": "<value>"} - Clear and type into a field
- {"action": "select", "element": <index>, "value": "<option>"} - Select a dropdown option
- {"action": "upload_resume", "element": <index>} - Upload the resume file
- {"action": "scroll_down"} - Scroll down to see more content
- {"action": "scroll_up"} - Scroll up
- {"action": "wait", "seconds": 2} - Wait for page to load
- {"action": "done", "status": "success"} - Application submitted successfully
- {"action": "done", "status": "failed", "reason": "..."} - Cannot complete application
- {"action": "done", "status": "needs_login", "platform": "linkedin"} - Need to log in (use "linkedin" or "indeed")

When filling forms:
- Use the candidate's real information from their profile
- For screening questions, answer truthfully based on the resume
- Be careful with checkboxes/radio buttons - click them to select
- After clicking Submit/Apply, wait and check if the application was confirmed
- If you see a success/confirmation message, respond with done/success
- If you hit a paywall, external redirect, or captcha, respond with done/failed
- If a field already has the correct value, do NOT re-type it -- move on
- For file upload inputs, use upload_resume (only for resume/CV file inputs)

IMPORTANT: Only return ONE action per response. Return ONLY valid JSON, no explanation.
"""

# JavaScript injected into the page to annotate interactive elements and
# return a structured listing.  Each element gets a ``data-agent-idx``
# attribute so we can reference it later.
_JS_EXTRACT_ELEMENTS = """
() => {
    // Remove old annotations
    document.querySelectorAll('[data-agent-idx]').forEach(el => {
        el.removeAttribute('data-agent-idx');
    });

    const interactiveTags = new Set([
        'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL',
    ]);
    const interactiveRoles = new Set([
        'button', 'link', 'checkbox', 'radio', 'menuitem', 'tab',
        'option', 'switch', 'combobox', 'textbox', 'searchbox',
        'listbox', 'menuitemcheckbox', 'menuitemradio',
    ]);

    function isVisible(el) {
        if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return true;
    }

    function getLabel(el) {
        // Check for aria-label
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
        // Check for associated label element
        if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) return label.textContent.trim();
        }
        // Check parent label
        const parentLabel = el.closest('label');
        if (parentLabel) {
            // Get label text excluding the input's own text
            const clone = parentLabel.cloneNode(true);
            clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
            return clone.textContent.trim();
        }
        // Check for placeholder
        if (el.placeholder) return el.placeholder;
        return '';
    }

    function getOptions(el) {
        if (el.tagName === 'SELECT') {
            return Array.from(el.options).map(o => ({
                value: o.value,
                text: o.textContent.trim(),
                selected: o.selected,
            }));
        }
        return [];
    }

    const allElements = document.querySelectorAll('a, button, input, select, textarea, [role]');
    const results = [];
    let idx = 0;

    for (const el of allElements) {
        const tag = el.tagName;
        const role = el.getAttribute('role') || '';

        // Skip if not interactive
        if (!interactiveTags.has(tag) && !interactiveRoles.has(role)) continue;

        // Skip hidden elements
        if (!isVisible(el)) continue;

        // Skip disabled elements
        if (el.disabled) continue;

        idx++;
        el.setAttribute('data-agent-idx', String(idx));

        const rect = el.getBoundingClientRect();
        const entry = {
            idx: idx,
            tag: tag.toLowerCase(),
            type: el.type || '',
            role: role,
            text: (el.textContent || '').trim().substring(0, 100),
            label: getLabel(el).substring(0, 100),
            placeholder: (el.placeholder || '').substring(0, 80),
            value: (el.value !== undefined ? String(el.value) : '').substring(0, 200),
            name: el.name || '',
            href: el.href ? el.href.substring(0, 200) : '',
            checked: el.checked || false,
            options: getOptions(el),
            rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
            },
        };

        results.push(entry);

        if (results.length >= MAX_ELEMENTS) break;
    }

    return results;
}
""".replace("MAX_ELEMENTS", str(MAX_ELEMENTS))

# JavaScript to extract visible error/alert messages
_JS_EXTRACT_ERRORS = """
() => {
    const errors = [];
    // Common error patterns
    const selectors = [
        '[role="alert"]',
        '.error-message', '.error', '.field-error',
        '.alert-danger', '.alert-error',
        '[class*="error" i]',
        '[class*="invalid" i]',
        '[aria-invalid="true"]',
    ];
    for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
            const text = (el.textContent || '').trim();
            if (text && text.length < 300) {
                errors.push(text);
            }
        }
    }
    // Deduplicate
    return [...new Set(errors)].slice(0, 10);
}
"""


class AgentApplier:
    """
    AI-powered browser agent that applies to jobs by observing the page,
    thinking via Claude, and acting with Playwright.

    Attributes:
        dry_run: If True, the agent will stop before any final submit action.
        max_steps: Maximum number of observe-think-act iterations.
        headless: Whether to run the browser headless during the agent loop.
    """

    def __init__(
        self,
        dry_run: bool = True,
        max_steps: int = 25,
        headless: bool = True,
    ) -> None:
        self.dry_run = dry_run
        self.max_steps = max_steps
        self.headless = headless

        self.db = SupabaseDB()
        self.claude = ClaudeClient()

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def apply_to_job(
        self,
        job_url: str,
        job_info: dict[str, Any],
        user_profile: dict[str, Any],
        resume_data: dict[str, Any],
        resume_file_path: str | None = None,
        queue_item_id: str | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Apply to a single job using the AI-powered browser agent.

        Args:
            job_url: Direct URL to the job posting.
            job_info: Dict with at least ``title`` and ``company``.
            user_profile: Dict with candidate info (name, email, phone, etc.)
            resume_data: Parsed resume data (skills, experience, summary, etc.)
            resume_file_path: Local path to the resume PDF/DOCX for upload.

        Returns:
            Result dict with keys:
              - ``status``: "success", "failed", "dry_run_complete", "needs_login"
              - ``steps``: list of step dicts (action, screenshot_path, timestamp)
              - ``message``: human-readable summary
        """
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

        result: dict[str, Any] = {
            "status": "failed",
            "steps": [],
            "message": "",
            "job_url": job_url,
        }

        # Build the context object that follows the agent through the loop
        context: dict[str, Any] = {
            "job_url": job_url,
            "job_info": job_info,
            "user_profile": user_profile,
            "resume_data": resume_data,
            "resume_file_path": resume_file_path,
            "action_history": [],
            "dry_run": self.dry_run,
            "queue_item_id": queue_item_id,
            "job_id": job_id,
        }

        # Log start
        self.db.log_apply_step(
            queue_item_id, job_id, 0, "start",
            f"Starting application for '{job_info.get('title')}' at '{job_info.get('company')}' — {job_url}",
        )

        platform = self._detect_platform(job_url)

        async with async_playwright() as pw:
            browser: Browser | None = None
            browser_context: BrowserContext | None = None

            try:
                # Launch browser and create context with session if available
                browser = await pw.chromium.launch(
                    headless=self.headless,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                browser_context = await self._create_context_with_session(
                    browser, platform
                )
                page = await browser_context.new_page()

                # Navigate to the job URL
                logger.info("Navigating to %s", job_url)
                self.db.log_apply_step(
                    queue_item_id, job_id, 0, "navigate",
                    f"Loading job page ({platform or 'unknown'} platform)",
                )
                await page.goto(
                    job_url,
                    wait_until="domcontentloaded",
                    timeout=NAV_TIMEOUT_MS,
                )
                await page.wait_for_timeout(2000)

                self.db.log_apply_step(
                    queue_item_id, job_id, 0, "page_loaded",
                    f"Page loaded: {await page.title()}",
                )

                # Run the agent loop
                result = await self._agent_loop(page, context)

                # Save session state after completion
                try:
                    if platform and browser_context:
                        storage = await browser_context.storage_state()
                        self.db.save_browser_session(platform, storage)
                        # Also save locally
                        session_file = SESSIONS_DIR / f"{platform}_session.json"
                        with open(session_file, "w") as f:
                            json.dump(storage, f, indent=2)
                        logger.info("Session state saved for %s.", platform)
                except Exception as exc:
                    logger.warning("Could not save session state: %s", exc)

            except Exception as exc:
                logger.error("Agent applier error: %s", exc, exc_info=True)
                result["status"] = "failed"
                result["message"] = f"Agent error: {str(exc)[:500]}"

            finally:
                if browser_context:
                    await browser_context.close()
                if browser:
                    await browser.close()

        return result

    # ------------------------------------------------------------------
    # Login flow
    # ------------------------------------------------------------------

    async def _login_flow(self, platform: str, pw: Any) -> BrowserContext | None:
        """
        Handle login when the agent detects a login page.

        Opens a visible (headless=False) browser at the platform's login URL,
        waits for the user to complete authentication (up to 5 minutes),
        saves the session state, and returns a new BrowserContext with the
        authenticated session.

        Returns None if login fails/times out.
        """
        login_url = LOGIN_URLS.get(platform)
        if not login_url:
            logger.error("No login URL for platform: %s", platform)
            return None

        logger.info(
            "Opening visible browser for %s login. "
            "Please log in manually within %d seconds.",
            platform,
            LOGIN_WAIT_SECONDS,
        )

        login_browser = await pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )

        login_context = await login_browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=USER_AGENT,
        )

        page = await login_context.new_page()
        await page.goto(login_url, wait_until="domcontentloaded")

        # Poll for login completion
        logged_in = False
        indicators = LOGIN_INDICATORS.get(platform, [])
        deadline = asyncio.get_event_loop().time() + LOGIN_WAIT_SECONDS

        while asyncio.get_event_loop().time() < deadline:
            await page.wait_for_timeout(2000)
            current_url = page.url

            # Check if we left the login pages
            on_login = any(ind in current_url for ind in indicators)
            if not on_login:
                logged_in = True
                break

        await page.close()

        if not logged_in:
            logger.error("%s login timed out after %d seconds.", platform, LOGIN_WAIT_SECONDS)
            await login_context.close()
            await login_browser.close()
            return None

        # Save session
        storage = await login_context.storage_state()
        self.db.save_browser_session(platform, storage)
        session_file = SESSIONS_DIR / f"{platform}_session.json"
        with open(session_file, "w") as f:
            json.dump(storage, f, indent=2)
        logger.info("%s login successful. Session saved.", platform)

        await login_context.close()
        await login_browser.close()

        # Return a new context with the saved session
        new_browser = await pw.chromium.launch(
            headless=self.headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        new_context = await new_browser.new_context(
            storage_state=storage,
            viewport={"width": 1280, "height": 900},
            user_agent=USER_AGENT,
        )
        return new_context

    # ------------------------------------------------------------------
    # Agent loop
    # ------------------------------------------------------------------

    async def _agent_loop(
        self,
        page: Page,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Core observe -> think -> act loop.

        Runs for up to ``self.max_steps`` iterations.  Returns a result dict.
        """
        result: dict[str, Any] = {
            "status": "failed",
            "steps": [],
            "message": "",
            "job_url": context["job_url"],
        }

        consecutive_failures = 0

        for step_num in range(1, self.max_steps + 1):
            logger.info("--- Agent step %d/%d ---", step_num, self.max_steps)

            # 1. Observe
            try:
                observation = await self._observe(page, step_num)
            except Exception as exc:
                logger.error("Observation failed at step %d: %s", step_num, exc)
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    result["message"] = "3 consecutive observation failures"
                    break
                continue

            # 2. Think
            try:
                action = await self._think(observation, context)
            except Exception as exc:
                logger.error("Thinking failed at step %d: %s", step_num, exc)
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    result["message"] = "3 consecutive thinking failures"
                    break
                continue

            if action is None:
                logger.warning("Claude returned unparseable action at step %d. Retrying.", step_num)
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    result["message"] = "3 consecutive invalid actions from Claude"
                    break
                continue

            # Reset consecutive failure counter on successful parse
            consecutive_failures = 0

            # Record the step
            step_record = {
                "step": step_num,
                "action": action,
                "screenshot": observation.get("screenshot_path", ""),
                "timestamp": datetime.utcnow().isoformat(),
            }
            result["steps"].append(step_record)
            context["action_history"].append(action)

            # Log the action to DB
            queue_item_id = context.get("queue_item_id")
            job_id = context.get("job_id")
            action_type = action.get("action", "unknown")
            action_detail = self._describe_action(action, observation.get("elements", []))
            self.db.log_apply_step(
                queue_item_id, job_id, step_num, action_type,
                action_detail,
                screenshot_path=observation.get("screenshot_path"),
            )

            # 3. Check for terminal actions
            if action.get("action") == "done":
                status = action.get("status", "failed")

                if status == "success":
                    result["status"] = "success"
                    result["message"] = "Application submitted successfully"
                    logger.info("Agent reports SUCCESS at step %d.", step_num)
                    self.db.log_apply_step(
                        queue_item_id, job_id, step_num, "done",
                        "Application submitted successfully", level="success",
                    )
                    return result

                elif status == "needs_login":
                    platform = action.get("platform", self._detect_platform(context["job_url"]))
                    result["status"] = "needs_login"
                    result["message"] = f"Login required for {platform}"
                    logger.info("Agent reports login needed for %s at step %d.", platform, step_num)
                    self.db.log_apply_step(
                        queue_item_id, job_id, step_num, "needs_login",
                        f"Login required for {platform}", level="warn",
                    )
                    return result

                else:
                    reason = action.get("reason", "Unknown reason")
                    result["status"] = "failed"
                    result["message"] = f"Agent gave up: {reason}"
                    logger.info("Agent reports FAILED at step %d: %s", step_num, reason)
                    self.db.log_apply_step(
                        queue_item_id, job_id, step_num, "failed",
                        f"Agent gave up: {reason}", level="error",
                    )
                    return result

            # 4. Dry-run guard: if the agent is about to click a submit button,
            #    intercept and stop.
            if self.dry_run and action.get("action") == "click":
                # Check if the target element looks like a submit button
                element_idx = action.get("element")
                if element_idx is not None:
                    elements = observation.get("elements", [])
                    target = next(
                        (e for e in elements if e.get("idx") == element_idx), None
                    )
                    if target and self._looks_like_submit(target):
                        result["status"] = "dry_run_complete"
                        result["message"] = (
                            "Dry run: stopped before clicking submit button "
                            f"(element [{element_idx}]: {target.get('text', '')!r})"
                        )
                        logger.info("DRY RUN: Stopping before submit at step %d.", step_num)
                        # Take a final screenshot
                        ss_path = await self._take_screenshot(page, f"dry_run_final_step{step_num:02d}")
                        step_record["screenshot"] = ss_path
                        self.db.log_apply_step(
                            queue_item_id, job_id, step_num, "dry_run_stop",
                            f"Dry run complete — would click: {target.get('text', '')!r}",
                            screenshot_path=ss_path,
                        )
                        return result

            # 5. Act
            try:
                await self._act(page, action, context)
            except Exception as exc:
                logger.warning(
                    "Action failed at step %d: %s -- %s",
                    step_num,
                    action,
                    exc,
                )
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    result["message"] = f"3 consecutive action failures (last: {exc})"
                    break
                # Take a screenshot of the failure and let Claude try again
                await self._take_screenshot(page, f"action_error_step{step_num:02d}")
                continue

            # Brief pause after action to let the page settle
            await page.wait_for_timeout(1000)

        else:
            result["message"] = f"Reached maximum step limit ({self.max_steps})"
            logger.warning("Agent exhausted step budget (%d steps).", self.max_steps)

        return result

    # ------------------------------------------------------------------
    # Observe
    # ------------------------------------------------------------------

    async def _observe(
        self,
        page: Page,
        step_num: int,
    ) -> dict[str, Any]:
        """
        Capture the current page state:
        - Screenshot (PNG, base64 encoded for Claude)
        - Simplified list of interactive elements
        - Any visible error messages

        Returns a dict with keys: screenshot_b64, screenshot_path, elements,
        errors, page_url, page_title.
        """
        # Take screenshot
        screenshot_path = await self._take_screenshot(page, f"step{step_num:02d}")
        screenshot_bytes = await page.screenshot(type="png")
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode("ascii")

        # Extract interactive elements via injected JS
        try:
            elements = await page.evaluate(_JS_EXTRACT_ELEMENTS)
        except Exception as exc:
            logger.warning("Element extraction failed: %s", exc)
            elements = []

        # Extract error messages
        try:
            errors = await page.evaluate(_JS_EXTRACT_ERRORS)
        except Exception:
            errors = []

        return {
            "screenshot_b64": screenshot_b64,
            "screenshot_path": screenshot_path,
            "elements": elements,
            "errors": errors,
            "page_url": page.url,
            "page_title": await page.title(),
        }

    # ------------------------------------------------------------------
    # Think
    # ------------------------------------------------------------------

    async def _think(
        self,
        observation: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any] | None:
        """
        Send the observation to Claude and get the next action.

        Returns a parsed action dict, or None if parsing fails.
        """
        # Build the element listing
        elements_text = self._format_elements(observation.get("elements", []))

        # Build context summary for Claude
        job_info = context.get("job_info", {})
        user_profile = context.get("user_profile", {})
        resume_data = context.get("resume_data", {})

        profile_summary = (
            f"Name: {user_profile.get('first_name', '')} {user_profile.get('last_name', '')}\n"
            f"Email: {user_profile.get('email', '')}\n"
            f"Phone: {user_profile.get('phone', '')}\n"
            f"Location: {user_profile.get('city', '')}, {user_profile.get('state', '')}\n"
            f"LinkedIn: {user_profile.get('linkedin_url', '')}\n"
            f"Website: {user_profile.get('website', '')}\n"
            f"Work Authorization: {user_profile.get('work_authorization', '')}\n"
        )

        resume_summary = (
            f"Summary: {resume_data.get('summary', '')}\n"
            f"Years of experience: {resume_data.get('years_of_experience', 0)}\n"
            f"Skills: {', '.join(resume_data.get('skills', [])[:20])}\n"
            f"Target titles: {', '.join(resume_data.get('target_titles', []))}\n"
        )

        # Build action history summary (last 10 actions)
        history = context.get("action_history", [])[-10:]
        history_text = ""
        if history:
            history_lines = []
            for i, act in enumerate(history, 1):
                history_lines.append(f"  {i}. {json.dumps(act)}")
            history_text = "Recent actions taken:\n" + "\n".join(history_lines)

        errors_text = ""
        if observation.get("errors"):
            errors_text = "Visible errors/alerts on page:\n" + "\n".join(
                f"  - {e}" for e in observation["errors"]
            )

        user_prompt = (
            f"GOAL: Apply to the job \"{job_info.get('title', 'Unknown')}\" "
            f"at \"{job_info.get('company', 'Unknown')}\".\n\n"
            f"Current page: {observation.get('page_url', '')}\n"
            f"Page title: {observation.get('page_title', '')}\n\n"
            f"CANDIDATE PROFILE:\n{profile_summary}\n"
            f"RESUME:\n{resume_summary}\n"
            f"INTERACTIVE ELEMENTS ON PAGE:\n{elements_text}\n"
        )

        if errors_text:
            user_prompt += f"\n{errors_text}\n"

        if history_text:
            user_prompt += f"\n{history_text}\n"

        if context.get("dry_run"):
            user_prompt += (
                "\nNOTE: This is a DRY RUN. Proceed normally but be aware "
                "that the system may stop you before the final submit.\n"
            )

        user_prompt += "\nWhat is the single best next action? Return ONLY valid JSON."

        # Call Claude with vision
        try:
            response_text = self.claude.call_api_with_image(
                system_prompt=AGENT_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                image_base64=observation["screenshot_b64"],
                max_tokens=1024,
                temperature=0.2,
            )
        except Exception as exc:
            logger.error("Claude API call failed: %s", exc)
            raise

        # Parse the JSON response
        return self._parse_action(response_text)

    # ------------------------------------------------------------------
    # Act
    # ------------------------------------------------------------------

    async def _act(
        self,
        page: Page,
        action: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """
        Execute a single action on the page.

        Raises on failure so the caller can handle retries.
        """
        action_type = action.get("action", "")
        element_idx = action.get("element")

        logger.info("Executing action: %s", json.dumps(action))

        if action_type == "click":
            locator = page.locator(f"[data-agent-idx='{element_idx}']")
            await locator.click(timeout=ACTION_TIMEOUT_MS)

        elif action_type == "type":
            text = action.get("text", "")
            locator = page.locator(f"[data-agent-idx='{element_idx}']")
            await locator.fill(text, timeout=ACTION_TIMEOUT_MS)

        elif action_type == "select":
            value = action.get("value", "")
            locator = page.locator(f"[data-agent-idx='{element_idx}']")
            # Try selecting by value first, then by label
            try:
                await locator.select_option(value=value, timeout=ACTION_TIMEOUT_MS)
            except Exception:
                await locator.select_option(label=value, timeout=ACTION_TIMEOUT_MS)

        elif action_type == "upload_resume":
            resume_path = context.get("resume_file_path", "")
            if not resume_path or not Path(resume_path).exists():
                raise FileNotFoundError(
                    f"Resume file not found: {resume_path!r}"
                )
            locator = page.locator(f"[data-agent-idx='{element_idx}']")
            await locator.set_input_files(resume_path, timeout=ACTION_TIMEOUT_MS)

        elif action_type == "scroll_down":
            await page.evaluate("window.scrollBy(0, 500)")

        elif action_type == "scroll_up":
            await page.evaluate("window.scrollBy(0, -500)")

        elif action_type == "wait":
            seconds = min(action.get("seconds", 2), 10)  # cap at 10s
            await page.wait_for_timeout(int(seconds * 1000))

        elif action_type == "done":
            # Terminal actions are handled by the loop, not here
            pass

        else:
            logger.warning("Unknown action type: %s", action_type)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _detect_platform(self, url: str) -> str | None:
        """Detect the platform from a URL."""
        url_lower = url.lower()
        if "linkedin.com" in url_lower:
            return "linkedin"
        elif "indeed.com" in url_lower:
            return "indeed"
        return None

    async def _create_context_with_session(
        self,
        browser: Browser,
        platform: str | None,
    ) -> BrowserContext:
        """
        Create a Playwright BrowserContext, loading saved session state
        if available for the given platform.
        """
        storage_state: dict[str, Any] | None = None

        if platform:
            # Try Supabase first
            try:
                session_row = self.db.get_browser_session(platform)
                if session_row:
                    raw = session_row.get("storage_state")
                    if isinstance(raw, dict):
                        storage_state = raw
                    elif isinstance(raw, str):
                        try:
                            storage_state = json.loads(raw)
                        except (json.JSONDecodeError, TypeError):
                            pass
            except Exception as exc:
                logger.warning("Could not load session from DB: %s", exc)

            # Fall back to local file
            if not storage_state:
                session_file = SESSIONS_DIR / f"{platform}_session.json"
                if session_file.exists():
                    try:
                        with open(session_file) as f:
                            storage_state = json.load(f)
                        logger.info("Loaded session from %s.", session_file)
                    except Exception as exc:
                        logger.warning("Could not load local session file: %s", exc)

        context_args: dict[str, Any] = {
            "viewport": {"width": 1280, "height": 900},
            "user_agent": USER_AGENT,
        }
        if storage_state:
            context_args["storage_state"] = storage_state
            logger.info("Using saved %s session.", platform)

        return await browser.new_context(**context_args)

    async def _take_screenshot(self, page: Page, label: str) -> str:
        """Take a screenshot and return the file path."""
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"agent_{label}_{timestamp}.png"
        filepath = SCREENSHOTS_DIR / filename
        try:
            await page.screenshot(path=str(filepath), full_page=False)
            logger.debug("Screenshot saved: %s", filepath)
        except Exception as exc:
            logger.warning("Screenshot failed (%s): %s", label, exc)
            return ""
        return str(filepath)

    @staticmethod
    def _format_elements(elements: list[dict[str, Any]]) -> str:
        """Format the element list into a readable string for Claude."""
        if not elements:
            return "(no interactive elements found)"

        lines = []
        for el in elements:
            idx = el.get("idx", "?")
            tag = el.get("tag", "?")
            el_type = el.get("type", "")
            role = el.get("role", "")
            text = el.get("text", "")
            label = el.get("label", "")
            placeholder = el.get("placeholder", "")
            value = el.get("value", "")
            name = el.get("name", "")
            checked = el.get("checked", False)
            options = el.get("options", [])

            # Build a concise description
            parts = [f"[{idx}]", f"<{tag}>"]

            if el_type:
                parts.append(f"type={el_type}")
            if role:
                parts.append(f"role={role}")
            if name:
                parts.append(f"name={name!r}")

            if label:
                parts.append(f"label={label!r}")
            elif text:
                parts.append(f"text={text!r}")

            if placeholder:
                parts.append(f"placeholder={placeholder!r}")
            if value:
                parts.append(f"value={value!r}")
            if checked:
                parts.append("CHECKED")

            if options:
                opt_strs = [
                    f"{'*' if o.get('selected') else ''}{o.get('text', o.get('value', ''))}"
                    for o in options[:10]
                ]
                parts.append(f"options=[{', '.join(opt_strs)}]")

            lines.append(" ".join(parts))

        return "\n".join(lines)

    @staticmethod
    def _describe_action(
        action: dict[str, Any],
        elements: list[dict[str, Any]],
    ) -> str:
        """Build a human-readable description of an agent action."""
        action_type = action.get("action", "unknown")
        element_idx = action.get("element")

        target_text = ""
        if element_idx is not None:
            target = next((e for e in elements if e.get("idx") == element_idx), None)
            if target:
                target_text = (target.get("text") or target.get("label") or target.get("tag", "")).strip()
                if len(target_text) > 80:
                    target_text = target_text[:77] + "..."

        if action_type == "click":
            return f"Click: {target_text or f'element [{element_idx}]'}"
        elif action_type == "type":
            typed = action.get("text", "")
            if len(typed) > 50:
                typed = typed[:47] + "..."
            return f"Type into {target_text or f'element [{element_idx}]'}: '{typed}'"
        elif action_type == "select":
            return f"Select '{action.get('value', '')}' in {target_text or f'element [{element_idx}]'}"
        elif action_type == "upload_resume":
            return f"Upload resume to {target_text or f'element [{element_idx}]'}"
        elif action_type == "scroll_down":
            return "Scroll down"
        elif action_type == "scroll_up":
            return "Scroll up"
        elif action_type == "wait":
            return f"Wait {action.get('seconds', 2)}s"
        elif action_type == "done":
            return f"Done — {action.get('status', 'unknown')}: {action.get('reason', '')}"
        return f"{action_type}: {action}"

    @staticmethod
    def _looks_like_submit(element: dict[str, Any]) -> bool:
        """
        Heuristic check: does this element look like a final submit button?
        """
        text = (element.get("text", "") + " " + element.get("label", "")).lower()
        submit_phrases = [
            "submit application",
            "submit my application",
            "send application",
            "submit",
            "apply now",
            "apply",
        ]
        # Exact-ish match to avoid false positives on "Apply filter" etc.
        text_stripped = text.strip()
        for phrase in submit_phrases:
            if text_stripped == phrase or text_stripped.startswith(phrase):
                return True

        el_type = element.get("type", "").lower()
        if el_type == "submit":
            return True

        return False

    @staticmethod
    def _parse_action(response_text: str) -> dict[str, Any] | None:
        """
        Parse Claude's response into a structured action dict.

        Handles responses that might have markdown fences or extra text
        around the JSON.
        """
        text = response_text.strip()

        # Remove markdown code fences
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(
                line for line in lines if not line.strip().startswith("```")
            ).strip()

        # Try to find a JSON object in the response
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            logger.warning("No JSON object found in Claude response: %s", text[:200])
            return None

        json_str = text[start : end + 1]
        try:
            parsed = json.loads(json_str)
        except json.JSONDecodeError as exc:
            logger.warning("JSON parse error: %s -- text: %s", exc, json_str[:200])
            return None

        if not isinstance(parsed, dict) or "action" not in parsed:
            logger.warning("Parsed JSON missing 'action' key: %s", parsed)
            return None

        return parsed


# ---------------------------------------------------------------------------
# Synchronous wrapper
# ---------------------------------------------------------------------------


def run_agent_applier(
    job_url: str,
    job_info: dict[str, Any],
    user_profile: dict[str, Any],
    resume_data: dict[str, Any],
    resume_file_path: str | None = None,
    dry_run: bool = True,
    max_steps: int = 25,
    headless: bool = True,
) -> dict[str, Any]:
    """
    Synchronous convenience wrapper around ``AgentApplier.apply_to_job``.

    Suitable for calling from non-async code or CLI scripts.
    """
    applier = AgentApplier(dry_run=dry_run, max_steps=max_steps, headless=headless)
    return asyncio.run(
        applier.apply_to_job(
            job_url=job_url,
            job_info=job_info,
            user_profile=user_profile,
            resume_data=resume_data,
            resume_file_path=resume_file_path,
        )
    )
