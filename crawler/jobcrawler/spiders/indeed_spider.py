"""
Indeed job search spider.

Primary strategy: RSS feed (https://www.indeed.com/rss?q={query}&l={location})
Fallback strategy: Playwright-rendered pages when RSS is blocked or unavailable.

Parses job listings and yields JobItem instances.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Generator
from urllib.parse import quote_plus

import scrapy
from scrapy.http import HtmlResponse, XmlResponse

from jobcrawler.items import JobItem
from jobcrawler.spiders.base_spider import BaseJobSpider

logger = logging.getLogger(__name__)


class IndeedSpider(BaseJobSpider):
    """Spider for Indeed job search via RSS feed with Playwright fallback."""

    name = "indeed"
    allowed_domains = ["indeed.com"]

    custom_settings = {
        "DOWNLOAD_DELAY": 7,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        "ROBOTSTXT_OBEY": False,  # Indeed blocks scrapers via robots.txt
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.results_count = 0
        self.max_results = int(kwargs.get("max_results", 200))
        self.rss_failed = False

    def start_requests(self) -> Generator[scrapy.Request, None, None]:
        self._start_time = time.time()

        query = quote_plus(self.query)
        location = quote_plus(self.location)

        # Try RSS feed first
        rss_url = f"https://www.indeed.com/rss?q={query}&l={location}"

        yield scrapy.Request(
            url=rss_url,
            callback=self.parse_rss,
            errback=self.rss_error,
            meta={
                "query": query,
                "location": location,
            },
            headers={
                "Accept": "application/rss+xml, application/xml, text/xml",
            },
        )

    def rss_error(self, failure: Any) -> Generator[scrapy.Request, None, None]:
        """Handle RSS feed failure by falling back to Playwright."""
        logger.warning("Indeed RSS feed failed: %s. Falling back to Playwright.", failure)
        self.rss_failed = True
        yield from self._playwright_requests(
            failure.request.meta.get("query", ""),
            failure.request.meta.get("location", ""),
        )

    def parse_rss(self, response: Any, **kwargs: Any) -> Generator[Any, None, None]:
        """Parse Indeed RSS feed response."""
        if self._check_time_limit():
            return

        # Check if we actually got XML back
        content_type = response.headers.get("Content-Type", b"").decode("utf-8", errors="ignore")
        body_preview = response.text[:200] if hasattr(response, "text") else ""

        if "<rss" not in body_preview and "<item" not in body_preview:
            logger.warning("Indeed RSS did not return valid XML. Falling back to Playwright.")
            self.rss_failed = True
            yield from self._playwright_requests(
                response.meta.get("query", ""),
                response.meta.get("location", ""),
            )
            return

        items = response.xpath("//item")

        if not items:
            logger.info("No items found in Indeed RSS feed.")
            yield from self._playwright_requests(
                response.meta.get("query", ""),
                response.meta.get("location", ""),
            )
            return

        for rss_item in items:
            if self._check_time_limit():
                return

            if self.results_count >= self.max_results:
                return

            try:
                job = self._parse_rss_item(rss_item)
                if job:
                    self.results_count += 1
                    yield job
            except Exception as e:
                logger.warning("Error parsing Indeed RSS item: %s", e)
                continue

        # Paginate RSS if possible (Indeed RSS doesn't natively paginate well)
        # Fall back to Playwright for additional pages
        if self.results_count < self.max_results and len(items) >= 10:
            yield from self._playwright_requests(
                response.meta.get("query", ""),
                response.meta.get("location", ""),
                start_page=1,  # Skip first page since RSS covered it
            )

    def _parse_rss_item(self, rss_item: scrapy.Selector) -> JobItem | None:
        """Parse a single RSS <item> element."""
        title = rss_item.xpath("title/text()").get("").strip()
        url = rss_item.xpath("link/text()").get("").strip()
        description_html = rss_item.xpath("description/text()").get("").strip()
        pub_date = rss_item.xpath("pubDate/text()").get("").strip()

        if not url or not title:
            return None

        url = self.normalize_url(url)

        # Extract company from "Company - Location" pattern in source
        source_text = rss_item.xpath("source/text()").get("").strip()
        company = ""
        location = ""
        if " - " in source_text:
            parts = source_text.rsplit(" - ", 1)
            company = parts[0].strip()
            location = parts[1].strip() if len(parts) > 1 else ""

        # Extract external ID from URL
        external_id = self._extract_job_id(url)

        # Check for remote
        combined = f"{title} {location} {description_html}"
        is_remote = self.extract_remote_flag(combined)

        # Try to extract salary from description
        salary_info = self.extract_salary(description_html)

        return JobItem(
            external_id=external_id,
            url=url,
            title=title,
            company=company,
            location=location,
            is_remote=is_remote,
            salary_min=salary_info["salary_min"],
            salary_max=salary_info["salary_max"],
            salary_text=salary_info["salary_text"],
            description_html=description_html,
            description_text="",  # Will be populated by CleaningPipeline
            posted_date=self.parse_date(pub_date) if pub_date else None,
            keywords=[],
            easy_apply=False,
            source_name="indeed",
            raw_data={
                "rss_item": rss_item.get(),
            },
        )

    def _playwright_requests(
        self,
        query: str,
        location: str,
        start_page: int = 0,
    ) -> Generator[scrapy.Request, None, None]:
        """Generate Playwright-based requests for Indeed web pages."""
        for page in range(start_page, self.max_pages):
            if self._check_time_limit():
                break

            if self.results_count >= self.max_results:
                break

            start = page * 10
            url = (
                f"https://www.indeed.com/jobs"
                f"?q={query}"
                f"&l={location}"
                f"&start={start}"
            )

            yield scrapy.Request(
                url=url,
                callback=self.parse_playwright,
                meta={
                    "playwright": True,
                    "playwright_include_page": False,
                    "page_num": page,
                },
                headers={
                    "Accept": "text/html",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )

    def parse_playwright(self, response: HtmlResponse, **kwargs: Any) -> Generator[JobItem, None, None]:
        """Parse Indeed search results rendered by Playwright."""
        if self._check_time_limit():
            return

        # Indeed job cards
        job_cards = response.css("div.job_seen_beacon, div.jobsearch-ResultsList > div")

        if not job_cards:
            # Try alternate selectors
            job_cards = response.css("td.resultContent, div.result")

        if not job_cards:
            logger.info("No job cards found on Indeed page %d", response.meta.get("page_num", 0))
            return

        for card in job_cards:
            if self._check_time_limit():
                return

            if self.results_count >= self.max_results:
                return

            try:
                item = self._parse_web_card(card, response)
                if item:
                    self.results_count += 1
                    yield item
            except Exception as e:
                logger.warning("Error parsing Indeed web card: %s", e)
                continue

    def _parse_web_card(self, card: scrapy.Selector, response: HtmlResponse) -> JobItem | None:
        """Parse a single Indeed web page job card."""

        # Title and link
        title_elem = card.css("h2.jobTitle a, a.jcs-JobTitle")
        if not title_elem:
            return None

        title = title_elem.css("span::text").get("").strip()
        if not title:
            title = title_elem.css("::text").get("").strip()

        relative_url = title_elem.attrib.get("href", "")
        if not relative_url:
            return None

        url = response.urljoin(relative_url)
        url = self.normalize_url(url)

        # Company name
        company = card.css(
            "span[data-testid='company-name']::text, "
            "span.companyName::text, "
            "a.companyOverviewLink::text"
        ).get("").strip()

        # Location
        location = card.css(
            "div[data-testid='text-location']::text, "
            "div.companyLocation::text"
        ).get("").strip()

        # Salary
        salary_text = card.css(
            "div.salary-snippet-container::text, "
            "div.metadata.salary-snippet-container span::text, "
            "span.estimated-salary span::text"
        ).get("").strip()

        salary_info = self.extract_salary(salary_text)

        # Date
        date_text = card.css(
            "span.date::text, "
            "span[data-testid='myJobsStateDate']::text"
        ).get("").strip()

        # Easy apply
        easy_apply = bool(card.css(
            "span.ialbl, "
            "span:contains('Easily apply'), "
            "span.iaLabel"
        ))

        # Snippet/description
        snippet = card.css(
            "div.job-snippet::text, "
            "ul li::text"
        ).getall()
        description_text = " ".join(s.strip() for s in snippet if s.strip())

        external_id = self._extract_job_id(url)
        is_remote = self.extract_remote_flag(f"{title} {location}")

        return JobItem(
            external_id=external_id,
            url=url,
            title=title,
            company=company,
            location=location,
            is_remote=is_remote,
            salary_min=salary_info["salary_min"],
            salary_max=salary_info["salary_max"],
            salary_text=salary_info["salary_text"],
            description_html="",
            description_text=description_text,
            posted_date=self.parse_date(date_text) if date_text else None,
            keywords=[],
            easy_apply=easy_apply,
            source_name="indeed",
            raw_data={
                "card_html": card.get(),
            },
        )

    @staticmethod
    def _extract_job_id(url: str) -> str:
        """Extract Indeed job key from URL."""
        match = re.search(r"jk=([a-f0-9]+)", url)
        if match:
            return f"indeed_{match.group(1)}"

        match = re.search(r"/viewjob\?.*jk=([a-f0-9]+)", url)
        if match:
            return f"indeed_{match.group(1)}"

        # Try clk param
        match = re.search(r"/rc/clk\?jk=([a-f0-9]+)", url)
        if match:
            return f"indeed_{match.group(1)}"

        return ""
