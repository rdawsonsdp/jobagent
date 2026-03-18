"""
Gmail API client for the Bakery Email Agent.

Handles OAuth2 authentication, email fetching (historical + polling),
and sending threaded replies.
"""

from __future__ import annotations

import base64
import logging
import os
import pickle
from email.mime.text import MIMEText
from typing import Any

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from email_agent.config import GMAIL_SCOPES

logger = logging.getLogger(__name__)

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

TOKEN_PATH = os.path.join(os.path.dirname(__file__), "..", "gmail_token.pickle")
CREDENTIALS_PATH = os.path.join(os.path.dirname(__file__), "..", "gmail_credentials.json")


class GmailClient:
    """Gmail API client with OAuth2 authentication."""

    def __init__(self) -> None:
        self._service = None

    def authenticate(self) -> None:
        """Authenticate with Gmail API using OAuth2."""
        creds = None

        if os.path.exists(TOKEN_PATH):
            with open(TOKEN_PATH, "rb") as f:
                creds = pickle.load(f)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(CREDENTIALS_PATH):
                    raise FileNotFoundError(
                        f"Gmail credentials not found at {CREDENTIALS_PATH}. "
                        "Download from Google Cloud Console > APIs & Services > Credentials."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(
                    CREDENTIALS_PATH, GMAIL_SCOPES
                )
                creds = flow.run_local_server(port=0)

            with open(TOKEN_PATH, "wb") as f:
                pickle.dump(creds, f)

        self._service = build("gmail", "v1", credentials=creds)
        logger.info("Gmail API authenticated successfully")

    @property
    def service(self):
        if self._service is None:
            self.authenticate()
        return self._service

    def fetch_messages(
        self,
        query: str = "",
        max_results: int = 100,
        page_token: str | None = None,
    ) -> dict[str, Any]:
        """
        Fetch messages matching a query.

        Args:
            query: Gmail search query (e.g., 'after:2025/01/01 in:inbox')
            max_results: Maximum messages to return per page
            page_token: Token for pagination

        Returns:
            Dict with 'messages' list and optional 'nextPageToken'
        """
        try:
            kwargs: dict[str, Any] = {
                "userId": "me",
                "q": query,
                "maxResults": max_results,
            }
            if page_token:
                kwargs["pageToken"] = page_token

            result = self.service.users().messages().list(**kwargs).execute()
            return result
        except Exception:
            logger.exception("Failed to fetch messages with query=%s", query)
            return {"messages": []}

    def get_message(self, message_id: str) -> dict[str, Any] | None:
        """Fetch a single message with full content."""
        try:
            msg = (
                self.service.users()
                .messages()
                .get(userId="me", id=message_id, format="full")
                .execute()
            )
            return msg
        except Exception:
            logger.exception("Failed to fetch message %s", message_id)
            return None

    def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        """Fetch a complete thread with all messages."""
        try:
            thread = (
                self.service.users()
                .threads()
                .get(userId="me", id=thread_id, format="full")
                .execute()
            )
            return thread
        except Exception:
            logger.exception("Failed to fetch thread %s", thread_id)
            return None

    def send_reply(
        self,
        to: str,
        subject: str,
        body: str,
        thread_id: str,
        message_id: str,
    ) -> dict[str, Any] | None:
        """
        Send a threaded reply to an email.

        Args:
            to: Recipient email address
            subject: Email subject (should include Re: prefix)
            body: Plain text reply body
            thread_id: Gmail thread ID to attach reply to
            message_id: Message-ID header of the email being replied to
        """
        try:
            message = MIMEText(body)
            message["to"] = to
            message["subject"] = subject if subject.startswith("Re:") else f"Re: {subject}"
            message["In-Reply-To"] = message_id
            message["References"] = message_id

            raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

            result = (
                self.service.users()
                .messages()
                .send(
                    userId="me",
                    body={"raw": raw, "threadId": thread_id},
                )
                .execute()
            )
            logger.info("Sent reply to %s (thread=%s)", to, thread_id)
            return result
        except Exception:
            logger.exception("Failed to send reply to %s", to)
            return None

    def add_label(self, message_id: str, label_ids: list[str]) -> None:
        """Add labels to a message."""
        try:
            self.service.users().messages().modify(
                userId="me",
                id=message_id,
                body={"addLabelIds": label_ids},
            ).execute()
        except Exception:
            logger.exception("Failed to add labels to %s", message_id)

    def remove_label(self, message_id: str, label_ids: list[str]) -> None:
        """Remove labels from a message."""
        try:
            self.service.users().messages().modify(
                userId="me",
                id=message_id,
                body={"removeLabelIds": label_ids},
            ).execute()
        except Exception:
            logger.exception("Failed to remove labels from %s", message_id)

    def create_label(self, name: str) -> str | None:
        """Create a Gmail label and return its ID."""
        try:
            label = (
                self.service.users()
                .labels()
                .create(
                    userId="me",
                    body={
                        "name": name,
                        "labelListVisibility": "labelShow",
                        "messageListVisibility": "show",
                    },
                )
                .execute()
            )
            return label["id"]
        except Exception:
            logger.exception("Failed to create label %s", name)
            return None

    def get_or_create_label(self, name: str) -> str | None:
        """Get existing label ID or create it."""
        try:
            labels = self.service.users().labels().list(userId="me").execute()
            for label in labels.get("labels", []):
                if label["name"] == name:
                    return label["id"]
            return self.create_label(name)
        except Exception:
            logger.exception("Failed to get/create label %s", name)
            return None

    def fetch_unprocessed(self, label_name: str = "BakeryAgent/Processed") -> list[dict]:
        """
        Fetch inbox emails that haven't been processed yet.

        Uses a Gmail label to track what's been processed.
        """
        processed_label = self.get_or_create_label(label_name)
        query = "in:inbox -label:BakeryAgent/Processed"
        result = self.fetch_messages(query=query, max_results=50)
        messages = []

        for msg_stub in result.get("messages", []):
            msg = self.get_message(msg_stub["id"])
            if msg:
                messages.append(msg)

        return messages

    def mark_processed(self, message_id: str) -> None:
        """Mark a message as processed by the agent."""
        label_id = self.get_or_create_label("BakeryAgent/Processed")
        if label_id:
            self.add_label(message_id, [label_id])


def parse_message_headers(message: dict) -> dict[str, str]:
    """Extract common headers from a Gmail API message."""
    headers = {}
    for header in message.get("payload", {}).get("headers", []):
        name = header["name"].lower()
        if name in ("from", "to", "subject", "date", "message-id", "in-reply-to"):
            headers[name] = header["value"]
    return headers


def extract_body_text(message: dict) -> str:
    """Extract plain text body from a Gmail API message."""
    payload = message.get("payload", {})

    # Simple single-part message
    if payload.get("mimeType") == "text/plain" and "body" in payload:
        data = payload["body"].get("data", "")
        if data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    # Multipart message - find text/plain part
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

        # Nested multipart
        for subpart in part.get("parts", []):
            if subpart.get("mimeType") == "text/plain":
                data = subpart.get("body", {}).get("data", "")
                if data:
                    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    return ""
