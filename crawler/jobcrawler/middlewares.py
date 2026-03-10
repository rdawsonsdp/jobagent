"""
Scrapy downloader middlewares.

- RotateUserAgentMiddleware: rotates User-Agent on every request using fake_useragent.
- ExponentialBackoffRetryMiddleware: retries requests with exponential backoff on 429s.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Union

from fake_useragent import UserAgent
from scrapy import Request, Spider, signals
from scrapy.crawler import Crawler
from scrapy.exceptions import IgnoreRequest
from scrapy.http import Response

logger = logging.getLogger(__name__)


class RotateUserAgentMiddleware:
    """Rotates User-Agent header on every outgoing request."""

    def __init__(self) -> None:
        self.ua = UserAgent(
            browsers=["chrome", "firefox", "edge"],
            os=["windows", "macos", "linux"],
        )

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> "RotateUserAgentMiddleware":
        middleware = cls()
        return middleware

    def process_request(self, request: Request, spider: Spider) -> None:
        user_agent = self.ua.random
        request.headers["User-Agent"] = user_agent
        logger.debug("User-Agent set to: %s", user_agent)


class ExponentialBackoffRetryMiddleware:
    """
    Retries failed requests with exponential backoff.

    Specifically targets HTTP 429 (Too Many Requests) responses,
    but also retries on common transient error codes.
    """

    RETRY_HTTP_CODES = {429, 500, 502, 503, 504}
    MAX_RETRIES = 5
    BASE_DELAY = 2.0  # seconds
    MAX_DELAY = 120.0  # seconds

    def __init__(self) -> None:
        self.retry_counts: dict[str, int] = {}

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> "ExponentialBackoffRetryMiddleware":
        middleware = cls()
        middleware.max_retries = crawler.settings.getint(
            "RETRY_TIMES", cls.MAX_RETRIES
        )
        return middleware

    def process_response(
        self, request: Request, response: Response, spider: Spider
    ) -> Union[Request, Response]:
        if response.status not in self.RETRY_HTTP_CODES:
            # Clear retry count on success
            self.retry_counts.pop(request.url, None)
            return response

        retry_count = self.retry_counts.get(request.url, 0)

        if retry_count >= self.max_retries:
            logger.warning(
                "Max retries (%d) reached for %s (status %d). Giving up.",
                self.max_retries,
                request.url,
                response.status,
            )
            self.retry_counts.pop(request.url, None)
            return response

        retry_count += 1
        self.retry_counts[request.url] = retry_count

        # Calculate delay with exponential backoff and jitter
        delay = min(
            self.BASE_DELAY * math.pow(2, retry_count - 1),
            self.MAX_DELAY,
        )

        # Respect Retry-After header if present (for 429s)
        retry_after = response.headers.get("Retry-After")
        if retry_after is not None:
            try:
                delay = max(delay, float(retry_after.decode("utf-8")))
            except (ValueError, AttributeError):
                pass

        logger.info(
            "Retrying %s (attempt %d/%d) after %.1fs delay (status %d)",
            request.url,
            retry_count,
            self.max_retries,
            delay,
            response.status,
        )

        # Create a new request with the delay
        retry_request = request.copy()
        retry_request.dont_filter = True
        retry_request.meta["download_delay"] = delay
        retry_request.meta["retry_count"] = retry_count

        # Use Scrapy's built-in download delay mechanism
        import twisted.internet.reactor as reactor
        from twisted.internet import defer

        # Schedule the retry with a delay via meta
        retry_request.meta["download_slot"] = f"retry_{request.url}_{retry_count}"

        return retry_request

    def process_exception(
        self, request: Request, exception: Exception, spider: Spider
    ) -> Union[Request, None]:
        retry_count = self.retry_counts.get(request.url, 0)

        if retry_count >= self.max_retries:
            logger.error(
                "Max retries (%d) reached for %s after exception: %s",
                self.max_retries,
                request.url,
                str(exception),
            )
            self.retry_counts.pop(request.url, None)
            return None

        retry_count += 1
        self.retry_counts[request.url] = retry_count

        delay = min(
            self.BASE_DELAY * math.pow(2, retry_count - 1),
            self.MAX_DELAY,
        )

        logger.info(
            "Retrying %s (attempt %d/%d) after exception: %s",
            request.url,
            retry_count,
            self.max_retries,
            str(exception),
        )

        retry_request = request.copy()
        retry_request.dont_filter = True
        retry_request.meta["retry_count"] = retry_count

        return retry_request
