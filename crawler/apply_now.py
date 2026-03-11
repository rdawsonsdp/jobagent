"""
On-demand auto-applier CLI -- triggered from the dashboard API.

Provides three modes:
  1. Apply to a specific job queue item (AI agent):
       python apply_now.py --item-id <uuid>
       python apply_now.py --item-id <uuid> --dry-run

  2. Open a visible browser for platform login/session capture:
       python apply_now.py --login linkedin
       python apply_now.py --login indeed

  3. Check session status:
       python apply_now.py --check-session linkedin

The apply mode loads the queue item + job details + user profile +
active resume from Supabase, then uses the AI-powered AgentApplier
to navigate the application flow via an observe-think-act loop.

The login mode opens a headed (visible) Chromium browser to the
platform's login page, waits for the user to log in, then saves
the browser session state for future auto-apply runs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Ensure project root is on the path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# Load environment
load_dotenv(PROJECT_ROOT / ".env")

from playwright.async_api import async_playwright

from jobcrawler.db.supabase_client import SupabaseDB
from jobcrawler.playwright_spiders.agent_applier import AgentApplier

logger = logging.getLogger(__name__)

# Directory for saved browser sessions
SESSIONS_DIR = PROJECT_ROOT / "sessions"
SCREENSHOTS_DIR = PROJECT_ROOT / "logs" / "screenshots"

LOGIN_URLS = {
    "linkedin": "https://www.linkedin.com/login",
    "indeed": "https://secure.indeed.com/auth",
}


def setup_logging(level: int = logging.INFO) -> None:
    """Configure console logging."""
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    )
    root.addHandler(handler)


# ------------------------------------------------------------------
# Apply to a single queue item
# ------------------------------------------------------------------


async def apply_single_item(item_id: str, dry_run: bool = False) -> dict[str, Any]:
    """
    Apply to a single auto_apply_queue item by ID using the AI agent.

    Steps:
      1. Fetch the queue item + linked job details from Supabase
      2. Load user profile and active resume
      3. Create an AgentApplier instance
      4. Call apply_to_job()
      5. Update the queue status based on the result

    Args:
        item_id: UUID of the auto_apply_queue row.
        dry_run: If True, fill forms but don't click submit.

    Returns:
        Result dict with status and details.
    """
    db = SupabaseDB()
    client = db.get_client()

    # ------------------------------------------------------------------
    # 1. Fetch the queue item with job and source info
    # ------------------------------------------------------------------
    response = (
        client.table("auto_apply_queue")
        .select("*, jobs(url, title, company, source_id, job_sources(name))")
        .eq("id", item_id)
        .single()
        .execute()
    )

    if not response.data:
        logger.error("Queue item not found: %s", item_id)
        return {"status": "error", "message": f"Queue item {item_id} not found"}

    item = response.data
    job = item.get("jobs") or {}
    source = job.get("job_sources") or {}
    platform = (source.get("name") or "unknown").lower()
    job_url = job.get("url", "")

    logger.info(
        "Applying to item %s: '%s' at '%s' (platform: %s)",
        item_id,
        job.get("title", "Unknown"),
        job.get("company", "Unknown"),
        platform,
    )

    if not job_url:
        db.update_auto_apply_status(item_id, "failed", "No job URL")
        return {"status": "failed", "message": "No job URL"}

    # ------------------------------------------------------------------
    # 2. Load user profile and active resume
    # ------------------------------------------------------------------
    user_profile = db.get_user_profile()
    if not user_profile:
        logger.error("No user profile found. Cannot proceed.")
        return {"status": "error", "message": "No user profile configured"}

    resume_record = db.get_active_resume()
    if not resume_record:
        logger.error("No active resume found. Cannot proceed.")
        return {"status": "error", "message": "No active resume configured"}

    resume_data = resume_record.get("parsed_data") or {}
    resume_file_path = resume_record.get("file_path") or os.getenv("RESUME_PATH", "")

    job_info = {
        "title": job.get("title", "Unknown"),
        "company": job.get("company", "Unknown"),
    }

    # Mark the item as approved if it's still pending
    current_status = item.get("status", "")
    if current_status == "pending_review":
        db.update_auto_apply_status(item_id, "approved")

    # ------------------------------------------------------------------
    # 3-4. Run the AI agent
    # ------------------------------------------------------------------
    agent = AgentApplier(dry_run=dry_run)
    result = await agent.apply_to_job(
        job_url=job_url,
        job_info=job_info,
        user_profile=user_profile,
        resume_data=resume_data,
        resume_file_path=resume_file_path if resume_file_path else None,
        queue_item_id=item_id,
        job_id=item.get("job_id"),
    )

    # ------------------------------------------------------------------
    # 5. Update queue status based on agent result
    # ------------------------------------------------------------------
    agent_status = result.get("status", "failed")
    agent_message = result.get("message", "")
    steps = result.get("steps", [])
    notes = f"Agent completed in {len(steps)} steps. {agent_message}"

    if agent_status == "success":
        db.update_auto_apply_status(
            item_id,
            "submitted",
            notes=notes,
            applied_at=datetime.utcnow().isoformat(),
        )
    elif agent_status == "dry_run_complete":
        db.update_auto_apply_status(item_id, "dry_run_complete", notes=notes)
    elif agent_status == "needs_login":
        db.update_auto_apply_status(item_id, "needs_login", notes=notes)
    else:
        db.update_auto_apply_status(item_id, "failed", notes=notes)

    # Log the attempt to application_attempts table
    try:
        last_screenshot = ""
        if steps:
            last_screenshot = steps[-1].get("screenshot", "")

        db.insert_application_attempt({
            "auto_apply_queue_id": item.get("id"),
            "job_id": item.get("job_id"),
            "platform": platform,
            "status": agent_status,
            "applied_at": datetime.utcnow().isoformat(),
            "notes": notes[:1000],
            "screenshot_path": last_screenshot,
        })
    except Exception as exc:
        logger.warning("Failed to log application attempt: %s", exc)

    return result


# ------------------------------------------------------------------
# Login session capture
# ------------------------------------------------------------------


async def login_session(platform: str) -> dict[str, Any]:
    """
    Open the user's default system browser for platform login.

    After the user logs in via the system browser, we launch a Playwright
    browser that connects to the same profile to capture session cookies.

    Args:
        platform: "linkedin" or "indeed"

    Returns:
        Result dict with status.
    """
    import subprocess
    import webbrowser

    platform = platform.lower()
    login_url = LOGIN_URLS.get(platform)

    if not login_url:
        return {"status": "error", "message": f"Unknown platform: {platform}"}

    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    session_file = SESSIONS_DIR / f"{platform}_session.json"

    # Open the login URL in the user's default system browser
    logger.info("Opening %s in your default browser...", login_url)
    webbrowser.open(login_url)

    logger.info(
        "Login page opened in your browser.\n"
        "Please log in to %s, then return here.\n"
        "Waiting up to 5 minutes for login to complete...",
        platform,
    )

    # Now launch a Playwright browser to capture the session after login.
    # We use a visible Playwright window that the user can ignore — it polls
    # the platform to detect when login is complete.
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )

        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        page = await context.new_page()
        await page.goto(login_url, wait_until="domcontentloaded")

        logger.info(
            "A Playwright window also opened — log in there too (or just "
            "in your normal browser). Session cookies will be captured "
            "from this window."
        )

        # Wait for the user to log in
        try:
            for _ in range(300):  # 5 minutes, check every second
                await page.wait_for_timeout(1000)
                current_url = page.url

                if platform == "linkedin" and "/feed" in current_url:
                    logger.info("LinkedIn login detected!")
                    break
                elif platform == "indeed" and "/auth" not in current_url:
                    logger.info("Indeed login detected!")
                    break
        except KeyboardInterrupt:
            logger.info("Login session interrupted by user")
        except Exception as e:
            logger.warning("Error during login wait: %s", e)

        # Save session state (both locally and to Supabase)
        try:
            storage_state = await context.storage_state()
            with open(session_file, "w") as f:
                json.dump(storage_state, f, indent=2)
            logger.info("Session state saved to %s", session_file)

            try:
                db = SupabaseDB()
                db.save_browser_session(platform, storage_state)
                logger.info("Session state saved to Supabase for %s", platform)
            except Exception as db_exc:
                logger.warning("Could not save session to Supabase: %s", db_exc)

            await browser.close()
            return {
                "status": "success",
                "message": f"Session saved for {platform}",
                "session_file": str(session_file),
            }
        except Exception as e:
            logger.error("Failed to save session state: %s", e)
            await browser.close()
            return {"status": "error", "message": f"Failed to save session: {e}"}


def check_session_status(platform: str) -> dict[str, Any]:
    """
    Check if a saved session exists and when it was last updated.

    Args:
        platform: "linkedin" or "indeed"

    Returns:
        Dict with valid (bool), last_updated (ISO string or None).
    """
    session_file = SESSIONS_DIR / f"{platform.lower()}_session.json"

    if not session_file.exists():
        return {"valid": False, "last_updated": None, "platform": platform}

    stat = session_file.stat()
    modified = datetime.fromtimestamp(stat.st_mtime).isoformat()

    return {
        "valid": True,
        "last_updated": modified,
        "platform": platform,
    }


# ------------------------------------------------------------------
# Process all approved queue items
# ------------------------------------------------------------------


async def process_queue(dry_run: bool = False) -> dict[str, Any]:
    """
    Process all auto_apply_queue items with status 'approved'.

    Applies to each job sequentially, updating status as it goes.

    Returns:
        Summary dict with counts.
    """
    db = SupabaseDB()
    client = db.get_client()

    response = (
        client.table("auto_apply_queue")
        .select("id")
        .eq("status", "approved")
        .order("created_at", desc=False)
        .execute()
    )

    items = response.data or []
    if not items:
        logger.info("No approved items in queue.")
        return {"processed": 0, "results": []}

    logger.info("Processing %d approved queue items...", len(items))
    results = []

    for item in items:
        item_id = item["id"]
        logger.info("--- Processing %s ---", item_id)
        try:
            result = await apply_single_item(item_id, dry_run=dry_run)
            results.append({"item_id": item_id, **result})
        except Exception as exc:
            logger.error("Error processing %s: %s", item_id, exc)
            results.append({"item_id": item_id, "status": "error", "message": str(exc)})

    summary = {
        "processed": len(results),
        "succeeded": sum(1 for r in results if r.get("status") in ("success", "dry_run_complete")),
        "failed": sum(1 for r in results if r.get("status") == "failed"),
        "results": results,
    }
    logger.info("Queue processing complete: %s", {k: v for k, v in summary.items() if k != "results"})
    return summary


# ------------------------------------------------------------------
# CLI entry point
# ------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="On-demand auto-applier triggered from the dashboard.",
    )
    parser.add_argument(
        "--item-id",
        type=str,
        help="UUID of the auto_apply_queue item to apply for",
    )
    parser.add_argument(
        "--login",
        type=str,
        choices=["linkedin", "indeed"],
        help="Open browser for platform login session capture",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Fill forms but don't click submit",
    )
    parser.add_argument(
        "--check-session",
        type=str,
        choices=["linkedin", "indeed"],
        help="Check if a saved session exists for a platform",
    )
    parser.add_argument(
        "--process-queue",
        action="store_true",
        default=False,
        help="Process all approved items in the auto_apply_queue",
    )

    args = parser.parse_args()

    setup_logging()

    if args.check_session:
        result = check_session_status(args.check_session)
        print(json.dumps(result))
        sys.exit(0)

    if args.item_id:
        result = asyncio.run(apply_single_item(args.item_id, dry_run=args.dry_run))
        print(json.dumps(result))
        sys.exit(0 if result.get("status") != "error" else 1)

    if args.process_queue:
        result = asyncio.run(process_queue(dry_run=args.dry_run))
        print(json.dumps(result))
        sys.exit(0)

    if args.login:
        result = asyncio.run(login_session(args.login))
        print(json.dumps(result))
        sys.exit(0 if result.get("status") == "success" else 1)

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
