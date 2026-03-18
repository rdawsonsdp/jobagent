"""
Bakery-specific configuration and constants.

Runtime config is loaded from the bakery_config Supabase table.
This module provides defaults and the loader.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

logger = logging.getLogger(__name__)

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "crawler", ".env"))

# Claude model for email tasks
MODEL = "claude-sonnet-4-20250514"
EMBEDDING_MODEL = "voyage-3"  # or use Claude for embeddings
MAX_TOKENS = 2048

# Polling interval (seconds)
POLL_INTERVAL = 120  # 2 minutes

# Confidence thresholds (can be overridden per-category in DB)
DEFAULT_AUTO_SEND_THRESHOLD = 0.90
DEFAULT_DRAFT_THRESHOLD = 0.70

# Gmail scopes required
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
]


class BakeryConfig:
    """Loads and caches bakery configuration from Supabase."""

    def __init__(self, supabase: Client | None = None) -> None:
        self._supabase = supabase
        self._cache: dict[str, Any] = {}

    def _get_client(self) -> Client:
        if self._supabase is None:
            url = os.getenv("SUPABASE_URL", "")
            key = os.getenv("SUPABASE_SERVICE_KEY", "")
            self._supabase = create_client(url, key)
        return self._supabase

    def load(self) -> None:
        """Load all config from database into cache."""
        try:
            result = self._get_client().table("bakery_config").select("*").execute()
            for row in result.data:
                self._cache[row["key"]] = row["value"]
            logger.info("Loaded %d config entries", len(self._cache))
        except Exception:
            logger.exception("Failed to load bakery config from DB")

    def get(self, key: str, default: Any = None) -> Any:
        """Get a config value, loading from DB if cache is empty."""
        if not self._cache:
            self.load()
        return self._cache.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Update a config value in DB and cache."""
        try:
            self._get_client().table("bakery_config").upsert(
                {"key": key, "value": json.dumps(value) if not isinstance(value, str) else value},
                on_conflict="key",
            ).execute()
            self._cache[key] = value
        except Exception:
            logger.exception("Failed to update config key=%s", key)

    def get_bakery_context(self) -> str:
        """Build a context string for Claude prompts with all bakery info."""
        if not self._cache:
            self.load()

        name = self.get("bakery_name", "Our Bakery")
        hours = self.get("hours", {})
        contact = self.get("contact", {})
        ordering = self.get("ordering_process", "")
        delivery = self.get("delivery_policy", "")
        cancellation = self.get("cancellation_policy", "")
        allergen = self.get("allergen_info", "")
        menu = self.get("menu_highlights", [])

        hours_str = "\n".join(f"  {day}: {time}" for day, time in hours.items()) if isinstance(hours, dict) else str(hours)
        menu_str = "\n".join(f"  - {item}" for item in menu) if isinstance(menu, list) else str(menu)

        return f"""Bakery Name: {name}

Business Hours:
{hours_str}

Contact Info:
  Phone: {contact.get('phone', 'N/A') if isinstance(contact, dict) else 'N/A'}
  Email: {contact.get('email', 'N/A') if isinstance(contact, dict) else 'N/A'}
  Address: {contact.get('address', 'N/A') if isinstance(contact, dict) else 'N/A'}

How to Order: {ordering}
Delivery Policy: {delivery}
Cancellation Policy: {cancellation}
Allergen Information: {allergen}

Menu Highlights:
{menu_str}"""

    def get_escalation_keywords(self) -> list[str]:
        """Get keywords that trigger automatic escalation."""
        return self.get("escalation_keywords", [
            "lawyer", "attorney", "health department",
            "allergic reaction", "hospital", "lawsuit", "food poisoning",
        ])

    def get_blocklist(self) -> list[str]:
        """Get email addresses that should never receive auto-replies."""
        return self.get("blocklist_addresses", [])

    def get_max_auto_replies_per_hour(self) -> int:
        return int(self.get("max_auto_replies_per_hour", 50))

    def is_auto_reply_enabled(self) -> bool:
        return bool(self.get("auto_reply_enabled", True))
