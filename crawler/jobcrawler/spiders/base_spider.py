"""
Base spider class with common utility methods shared by all job spiders.

Provides helpers for URL normalization, salary extraction, remote flag
detection, and date parsing.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

import scrapy

logger = logging.getLogger(__name__)


class BaseJobSpider(scrapy.Spider):
    """
    Abstract base spider for job listing crawlers.

    Subclasses must define:
        name: str
        allowed_domains: list[str]
        start_urls: list[str] (or override start_requests)

    And implement parse() to yield JobItem instances.
    """

    # Default settings that can be overridden per spider
    custom_settings: dict[str, Any] = {}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.query: str = kwargs.get("query", "software engineer")
        self.location: str = kwargs.get("location", "United States")
        self.max_pages: int = int(kwargs.get("max_pages", 10))
        self.time_limit: int = int(kwargs.get("time_limit", 0))  # seconds, 0 = no limit
        self._start_time: float | None = None

    def _check_time_limit(self) -> bool:
        """Returns True if the spider has exceeded its time limit."""
        if self.time_limit <= 0 or self._start_time is None:
            return False
        import time
        elapsed = time.time() - self._start_time
        if elapsed >= self.time_limit:
            logger.info(
                "Spider '%s' reached time limit of %ds (elapsed: %.0fs)",
                self.name,
                self.time_limit,
                elapsed,
            )
            return True
        return False

    @staticmethod
    def normalize_url(url: str) -> str:
        """
        Normalize a URL by lowercasing the scheme and host, removing
        tracking parameters, and stripping trailing slashes and fragments.
        """
        if not url:
            return ""

        parsed = urlparse(url.strip())
        tracking_params = {
            "utm_source", "utm_medium", "utm_campaign", "utm_term",
            "utm_content", "ref", "refId", "trackingId", "trk",
            "currentJobId", "eBP", "recommendedFlavor", "refId",
        }
        params = parse_qs(parsed.query)
        filtered = {k: v for k, v in params.items() if k not in tracking_params}
        clean_query = urlencode(filtered, doseq=True)

        normalized = urlunparse((
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
            parsed.params,
            clean_query,
            "",  # drop fragment
        ))
        return normalized

    @staticmethod
    def extract_salary(text: str) -> dict[str, Any]:
        """
        Extract salary information from a text string.

        Returns dict with keys: salary_min, salary_max, salary_text.
        Values may be None if not found.
        """
        result: dict[str, Any] = {
            "salary_min": None,
            "salary_max": None,
            "salary_text": None,
        }

        if not text:
            return result

        # Clean up the text
        text = text.strip()
        result["salary_text"] = text

        # Match patterns like "$80,000 - $120,000", "$80K-$120K", etc.
        range_pattern = re.compile(
            r"\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*[kK]?",
            re.IGNORECASE,
        )
        match = range_pattern.search(text)
        if match:
            low = match.group(1).replace(",", "")
            high = match.group(2).replace(",", "")

            low_val = float(low)
            high_val = float(high)

            # Handle K suffix
            low_text = text[match.start():match.end()].lower()
            if "k" in low_text or low_val < 1000:
                if low_val < 1000:
                    low_val *= 1000
                if high_val < 1000:
                    high_val *= 1000

            result["salary_min"] = int(low_val)
            result["salary_max"] = int(high_val)
            return result

        # Match single salary like "$95,000/year" or "$95K"
        single_pattern = re.compile(
            r"\$\s*([\d,]+(?:\.\d+)?)\s*[kK]?",
            re.IGNORECASE,
        )
        match = single_pattern.search(text)
        if match:
            val = float(match.group(1).replace(",", ""))
            if "k" in text[match.start():match.end()].lower() or val < 1000:
                if val < 1000:
                    val *= 1000
            result["salary_min"] = int(val)
            result["salary_max"] = int(val)

        return result

    @staticmethod
    def extract_remote_flag(text: str) -> bool:
        """
        Determine if a job is remote based on text content.
        Checks title, location, and description snippets.
        """
        if not text:
            return False

        lower = text.lower()
        remote_indicators = [
            "remote",
            "work from home",
            "work-from-home",
            "wfh",
            "telecommute",
            "distributed",
            "anywhere",
        ]
        # Negative indicators (hybrid, on-site mentions with remote)
        negative_indicators = [
            "not remote",
            "no remote",
            "on-site only",
            "onsite only",
            "in-office only",
        ]

        for neg in negative_indicators:
            if neg in lower:
                return False

        for indicator in remote_indicators:
            if indicator in lower:
                return True

        return False

    @staticmethod
    def parse_date(date_str: str) -> str | None:
        """
        Parse a date string into YYYY-MM-DD format.
        Handles relative dates like "3 days ago" and common absolute formats.
        """
        if not date_str:
            return None

        date_str = date_str.strip()

        # Already in target format
        if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
            return date_str

        lower = date_str.lower()

        # Handle relative dates
        if lower in ("today", "just posted", "just now", "moments ago"):
            return datetime.utcnow().strftime("%Y-%m-%d")

        if lower == "yesterday":
            return (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")

        relative_patterns = [
            (r"(\d+)\s*min", "minutes"),
            (r"(\d+)\s*hour", "hours"),
            (r"(\d+)\s*day", "days"),
            (r"(\d+)\s*week", "weeks"),
            (r"(\d+)\s*month", "months"),
        ]
        for pattern, unit in relative_patterns:
            match = re.search(pattern, lower)
            if match:
                amount = int(match.group(1))
                now = datetime.utcnow()
                if unit == "minutes":
                    delta = timedelta(minutes=amount)
                elif unit == "hours":
                    delta = timedelta(hours=amount)
                elif unit == "days":
                    delta = timedelta(days=amount)
                elif unit == "weeks":
                    delta = timedelta(weeks=amount)
                elif unit == "months":
                    delta = timedelta(days=amount * 30)
                else:
                    continue
                return (now - delta).strftime("%Y-%m-%d")

        # Try common absolute formats
        formats = [
            "%Y-%m-%d",
            "%m/%d/%Y",
            "%B %d, %Y",
            "%b %d, %Y",
            "%d %B %Y",
            "%d %b %Y",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%SZ",
        ]
        for fmt in formats:
            try:
                parsed = datetime.strptime(date_str, fmt)
                return parsed.strftime("%Y-%m-%d")
            except ValueError:
                continue

        logger.warning("Could not parse date: %s", date_str)
        return None
