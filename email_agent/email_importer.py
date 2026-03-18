"""
Historical email import pipeline.

Connects to Gmail, fetches historical threads, pairs Q&A,
classifies them, and generates embeddings for similarity search.
"""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client, create_client

from email_agent.classifier import EmailClassifier
from email_agent.config import BakeryConfig
from email_agent.email_parser import pair_thread_emails, parse_email
from email_agent.gmail_client import GmailClient

logger = logging.getLogger(__name__)


class EmailImporter:
    """Imports historical emails from Gmail into the database."""

    def __init__(
        self,
        gmail: GmailClient,
        supabase: Client,
        classifier: EmailClassifier,
        bakery_config: BakeryConfig,
    ) -> None:
        self.gmail = gmail
        self.db = supabase
        self.classifier = classifier
        self.config = bakery_config
        self.bakery_email = self.config.get("contact", {}).get("email", "")

    def import_historical(self, days_back: int = 365, batch_size: int = 100) -> dict[str, int]:
        """
        Import historical emails from the last N days.

        Returns stats about the import.
        """
        stats = {"threads": 0, "emails": 0, "pairs": 0, "errors": 0}

        query = f"after:{_days_ago(days_back)} in:inbox OR in:sent"
        page_token = None

        while True:
            result = self.gmail.fetch_messages(
                query=query,
                max_results=batch_size,
                page_token=page_token,
            )

            message_stubs = result.get("messages", [])
            if not message_stubs:
                break

            # Collect unique thread IDs
            thread_ids = list({m["threadId"] for m in message_stubs})

            for thread_id in thread_ids:
                try:
                    self._import_thread(thread_id, stats)
                except Exception:
                    logger.exception("Failed to import thread %s", thread_id)
                    stats["errors"] += 1

            page_token = result.get("nextPageToken")
            if not page_token:
                break

            logger.info(
                "Import progress: %d threads, %d emails, %d pairs",
                stats["threads"], stats["emails"], stats["pairs"],
            )

        logger.info("Import complete: %s", stats)
        return stats

    def _import_thread(self, thread_id: str, stats: dict[str, int]) -> None:
        """Import a single thread and its Q&A pairs."""
        # Check if thread already imported
        existing = (
            self.db.table("bakery_emails")
            .select("id")
            .eq("thread_id", thread_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return

        thread = self.gmail.get_thread(thread_id)
        if not thread:
            return

        stats["threads"] += 1
        parsed_messages = []

        # Parse and store each message
        for raw_msg in thread.get("messages", []):
            parsed = parse_email(raw_msg, self.bakery_email)

            result = (
                self.db.table("bakery_emails")
                .upsert(parsed, on_conflict="message_id")
                .execute()
            )

            if result.data:
                parsed["id"] = result.data[0]["id"]
                parsed_messages.append(parsed)
                stats["emails"] += 1

        # Pair customer questions with staff responses
        pairs = pair_thread_emails(parsed_messages, self.bakery_email)

        for pair in pairs:
            customer = pair["customer"]
            response = pair["response"]

            if not customer.get("id") or not response.get("id"):
                continue

            # Classify the customer email
            classification = self.classifier.classify(customer.get("body_text", ""))

            # Store the pair
            pair_record = {
                "thread_id": thread_id,
                "customer_email_id": customer["id"],
                "response_email_id": response["id"],
                "category": classification.get("category"),
                "subcategory": classification.get("subcategory"),
            }

            self.db.table("bakery_email_pairs").insert(pair_record).execute()
            stats["pairs"] += 1

            # Update category example count
            if classification.get("category"):
                self._increment_category_count(classification["category"])

    def _increment_category_count(self, category: str) -> None:
        """Increment the example_count for a category."""
        try:
            current = (
                self.db.table("bakery_email_categories")
                .select("example_count")
                .eq("name", category)
                .single()
                .execute()
            )
            if current.data:
                new_count = (current.data.get("example_count") or 0) + 1
                self.db.table("bakery_email_categories").update(
                    {"example_count": new_count}
                ).eq("name", category).execute()
        except Exception:
            logger.warning("Failed to update example_count for %s", category)


def _days_ago(days: int) -> str:
    """Return a date string N days ago in YYYY/MM/DD format."""
    from datetime import datetime, timedelta, timezone

    dt = datetime.now(timezone.utc) - timedelta(days=days)
    return dt.strftime("%Y/%m/%d")
