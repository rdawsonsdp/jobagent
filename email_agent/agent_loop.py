"""
Main agent loop for the Bakery Email Agent.

Polls Gmail for new emails, classifies them, generates responses,
and routes them to auto-send, draft review, or escalation.
"""

from __future__ import annotations

import logging
import os
import signal
import time
from datetime import datetime, timezone
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv
from supabase import Client, create_client

from email_agent.classifier import EmailClassifier
from email_agent.config import POLL_INTERVAL, BakeryConfig
from email_agent.email_parser import parse_email
from email_agent.gmail_client import GmailClient
from email_agent.response_engine import ResponseEngine

logger = logging.getLogger(__name__)

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


class BakeryEmailAgent:
    """
    Main email agent that orchestrates the full pipeline:
    poll -> parse -> classify -> respond -> route
    """

    def __init__(self) -> None:
        # Initialize clients
        self.gmail = GmailClient()
        self.db: Client = create_client(
            os.getenv("SUPABASE_URL", ""),
            os.getenv("SUPABASE_SERVICE_KEY", ""),
        )
        self.anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

        # Initialize components
        self.config = BakeryConfig(self.db)
        self.config.load()

        self.classifier = EmailClassifier(self.anthropic)
        self._load_categories()

        self.response_engine = ResponseEngine(
            self.anthropic, self.db, self.config,
        )

        self.bakery_email = self.config.get("contact", {}).get("email", "")
        self._running = True
        self._auto_send_count_this_hour = 0
        self._hour_start = datetime.now(timezone.utc)

    def _load_categories(self) -> None:
        """Load email categories from database."""
        try:
            result = self.db.table("bakery_email_categories").select("*").execute()
            self.classifier.set_categories(result.data or [])
            logger.info("Loaded %d email categories", len(result.data or []))
        except Exception:
            logger.exception("Failed to load categories")

    def run(self) -> None:
        """Main polling loop."""
        logger.info("Bakery Email Agent starting...")
        self.gmail.authenticate()

        # Handle graceful shutdown
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

        while self._running:
            try:
                self._process_cycle()
                self._process_approved_drafts()
            except Exception:
                logger.exception("Error in processing cycle")

            if self._running:
                logger.debug("Sleeping %ds until next poll", POLL_INTERVAL)
                time.sleep(POLL_INTERVAL)

        logger.info("Bakery Email Agent stopped")

    def run_once(self) -> dict[str, int]:
        """Run a single processing cycle (useful for testing/cron)."""
        self.gmail.authenticate()
        return self._process_cycle()

    def _process_cycle(self) -> dict[str, int]:
        """Process all unprocessed emails in a single cycle."""
        stats = {"processed": 0, "auto_sent": 0, "drafted": 0, "escalated": 0, "errors": 0}

        # Reset hourly counter if needed
        now = datetime.now(timezone.utc)
        if (now - self._hour_start).total_seconds() >= 3600:
            self._auto_send_count_this_hour = 0
            self._hour_start = now

        if not self.config.is_auto_reply_enabled():
            logger.info("Auto-reply is disabled globally")
            return stats

        # Fetch unprocessed emails
        messages = self.gmail.fetch_unprocessed()
        logger.info("Found %d unprocessed emails", len(messages))

        for raw_msg in messages:
            try:
                self._process_single_email(raw_msg, stats)
            except Exception:
                logger.exception("Failed to process email %s", raw_msg.get("id"))
                stats["errors"] += 1

        logger.info("Cycle complete: %s", stats)
        return stats

    def _process_single_email(self, raw_msg: dict, stats: dict[str, int]) -> None:
        """Process a single incoming email through the full pipeline."""
        # Parse the email
        parsed = parse_email(raw_msg, self.bakery_email)

        # Skip outbound emails
        if parsed["direction"] == "outbound":
            self.gmail.mark_processed(raw_msg["id"])
            return

        # Check blocklist
        from email_agent.email_parser import extract_email_address
        sender = extract_email_address(parsed["from_address"])
        if sender.lower() in [b.lower() for b in self.config.get_blocklist()]:
            logger.info("Skipping blocklisted sender: %s", sender)
            self.gmail.mark_processed(raw_msg["id"])
            return

        # Store email in database
        result = (
            self.db.table("bakery_emails")
            .upsert(parsed, on_conflict="message_id")
            .execute()
        )
        if not result.data:
            return

        email_record = result.data[0]
        email_id = email_record["id"]

        # Classify
        classification = self.classifier.classify(
            parsed.get("body_text", ""),
            parsed.get("subject", ""),
        )
        logger.info(
            "Classified email %s as %s (confidence=%.2f)",
            email_id, classification["category"], classification["confidence"],
        )

        # Generate response
        response = self.response_engine.generate_response(email_record, classification)

        # Route based on action
        action_record = {
            "email_id": email_id,
            "category": classification["category"],
            "confidence": response["confidence"],
            "draft_response": response["draft_response"],
            "similar_examples": response["similar_examples"],
        }

        if response["action"] == "auto_send" and self._can_auto_send():
            action_record["action"] = "auto_replied"
            action_record["status"] = "sent"
            action_record["final_response"] = response["draft_response"]
            action_record["sent_at"] = datetime.now(timezone.utc).isoformat()

            # Send the reply
            sent = self.gmail.send_reply(
                to=parsed["from_address"],
                subject=parsed.get("subject", ""),
                body=response["draft_response"],
                thread_id=parsed["thread_id"],
                message_id=parsed["message_id"],
            )

            if sent:
                self._auto_send_count_this_hour += 1
                stats["auto_sent"] += 1
                logger.info("Auto-sent reply for email %s", email_id)
            else:
                action_record["action"] = "drafted"
                action_record["status"] = "pending"
                action_record.pop("final_response", None)
                action_record.pop("sent_at", None)
                stats["drafted"] += 1

        elif response["action"] == "escalate":
            action_record["action"] = "escalated"
            action_record["status"] = "pending"
            stats["escalated"] += 1
            logger.info("Escalated email %s: %s", email_id, response["reasoning"])

        else:
            action_record["action"] = "drafted"
            action_record["status"] = "pending"
            stats["drafted"] += 1
            logger.info("Drafted response for email %s (confidence=%.2f)", email_id, response["confidence"])

        # Store the action
        self.db.table("bakery_email_actions").insert(action_record).execute()

        # Mark as processed in Gmail
        self.gmail.mark_processed(raw_msg["id"])

        # Mark as processed in DB
        self.db.table("bakery_emails").update(
            {"is_processed": True}
        ).eq("id", email_id).execute()

        stats["processed"] += 1

    def _process_approved_drafts(self) -> None:
        """Send any drafts that have been approved by humans via the dashboard."""
        try:
            result = (
                self.db.table("bakery_email_actions")
                .select("*, bakery_emails(*)")
                .eq("status", "approved")
                .is_("sent_at", "null")
                .execute()
            )

            for action in result.data or []:
                email = action.get("bakery_emails")
                if not email:
                    continue

                response_text = action.get("final_response") or action.get("draft_response")
                if not response_text:
                    continue

                sent = self.gmail.send_reply(
                    to=email["from_address"],
                    subject=email.get("subject", ""),
                    body=response_text,
                    thread_id=email["thread_id"],
                    message_id=email["message_id"],
                )

                if sent:
                    self.db.table("bakery_email_actions").update({
                        "status": "sent",
                        "sent_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", action["id"]).execute()
                    logger.info("Sent approved draft for action %s", action["id"])

        except Exception:
            logger.exception("Failed to process approved drafts")

    def _can_auto_send(self) -> bool:
        """Check if we're under the hourly auto-send rate limit."""
        max_per_hour = self.config.get_max_auto_replies_per_hour()
        return self._auto_send_count_this_hour < max_per_hour

    def _handle_shutdown(self, signum: int, frame: Any) -> None:
        """Handle graceful shutdown on SIGINT/SIGTERM."""
        logger.info("Shutdown signal received, stopping after current cycle...")
        self._running = False


def main() -> None:
    """Entry point for the email agent."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    agent = BakeryEmailAgent()
    agent.run()


if __name__ == "__main__":
    main()
