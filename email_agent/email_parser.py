"""
Email parsing and thread pairing utilities.

Converts raw Gmail API messages into structured records and pairs
customer questions with staff responses for training data.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from email_agent.gmail_client import extract_body_text, parse_message_headers

logger = logging.getLogger(__name__)


def parse_email(raw_message: dict[str, Any], bakery_address: str) -> dict[str, Any]:
    """
    Parse a raw Gmail API message into a structured email record.

    Returns a dict ready for insertion into the bakery_emails table.
    """
    headers = parse_message_headers(raw_message)
    from_addr = headers.get("from", "")
    to_addr = headers.get("to", "")
    body = extract_body_text(raw_message)

    # Determine direction based on from address
    from_email = extract_email_address(from_addr)
    direction = "outbound" if bakery_address.lower() in from_email.lower() else "inbound"

    # Parse date
    date_str = headers.get("date", "")
    received_at = parse_email_date(date_str)

    # Check for attachments
    has_attachments = _has_attachments(raw_message.get("payload", {}))

    return {
        "message_id": headers.get("message-id", raw_message.get("id", "")),
        "thread_id": raw_message.get("threadId", ""),
        "from_address": from_addr,
        "to_address": to_addr,
        "subject": headers.get("subject", ""),
        "body_text": clean_email_body(body),
        "body_html": None,  # Skip HTML for storage efficiency
        "direction": direction,
        "received_at": received_at.isoformat(),
        "labels": raw_message.get("labelIds", []),
        "has_attachments": has_attachments,
    }


def extract_email_address(full_address: str) -> str:
    """Extract just the email from 'Name <email@example.com>' format."""
    match = re.search(r"<([^>]+)>", full_address)
    return match.group(1) if match else full_address.strip()


def parse_email_date(date_str: str) -> datetime:
    """Parse various email date formats into a datetime."""
    if not date_str:
        return datetime.now(timezone.utc)

    # Common email date formats
    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
    ]

    # Remove parenthesized timezone name like "(PST)"
    cleaned = re.sub(r"\s*\([^)]+\)\s*$", "", date_str.strip())

    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue

    logger.warning("Could not parse date: %s", date_str)
    return datetime.now(timezone.utc)


def clean_email_body(body: str) -> str:
    """
    Clean email body text by removing signatures, quoted replies,
    and excessive whitespace.
    """
    if not body:
        return ""

    lines = body.split("\n")
    cleaned_lines = []

    for line in lines:
        # Stop at common signature markers
        stripped = line.strip()
        if stripped in ("--", "---", "Sent from my iPhone", "Sent from my Android"):
            break
        # Stop at quoted reply markers
        if stripped.startswith(">") or stripped.startswith("On ") and "wrote:" in stripped:
            break
        cleaned_lines.append(line)

    text = "\n".join(cleaned_lines).strip()

    # Collapse excessive whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text


def pair_thread_emails(
    thread_messages: list[dict[str, Any]],
    bakery_address: str,
) -> list[dict[str, Any]]:
    """
    Given a list of parsed emails in a thread (ordered by time),
    pair each inbound customer email with the next outbound staff response.

    Returns a list of pairs:
      [{"customer": {...}, "response": {...}}, ...]
    """
    pairs = []
    pending_customer_email = None

    for msg in sorted(thread_messages, key=lambda m: m.get("received_at", "")):
        if msg["direction"] == "inbound":
            pending_customer_email = msg
        elif msg["direction"] == "outbound" and pending_customer_email is not None:
            pairs.append({
                "customer": pending_customer_email,
                "response": msg,
            })
            pending_customer_email = None

    return pairs


def _has_attachments(payload: dict) -> bool:
    """Check if a message payload has attachments."""
    if payload.get("filename"):
        return True
    for part in payload.get("parts", []):
        if part.get("filename"):
            return True
        if _has_attachments(part):
            return True
    return False
