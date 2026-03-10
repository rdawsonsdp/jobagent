"""
LinkedIn public job search spider.

Uses the guest API endpoint (no authentication required) to scrape
public job listings from LinkedIn's job search.

Endpoint:
    https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
    ?keywords={query}&location={location}&start={offset}

Parses HTML response cards to extract job data and paginates through results.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Generator
from urllib.parse import quote_plus

import scrapy
from scrapy.http import HtmlResponse

from jobcrawler.items import JobItem
from jobcrawler.spiders.base_spider import BaseJobSpider

logger = logging.getLogger(__name__)


class LinkedInSpider(BaseJobSpider):
    """Spider for LinkedIn public guest job search API."""

    name = "linkedin"
    allowed_domains = ["linkedin.com"]

    # LinkedIn returns 25 results per page
    RESULTS_PER_PAGE = 25

    custom_settings = {
        "DOWNLOAD_DELAY": 6,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        "ROBOTSTXT_OBEY": False,  # LinkedIn robots.txt blocks guest API
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.results_count = 0
        self.max_results = int(kwargs.get("max_results", 250))

    def start_requests(self) -> Generator[scrapy.Request, None, None]:
        import time as _time
        self._start_time = _time.time()

        keywords = quote_plus(self.query)
        location = quote_plus(self.location)

        for page in range(self.max_pages):
            if self._check_time_limit():
                break

            offset = page * self.RESULTS_PER_PAGE
            url = (
                f"https://www.linkedin.com/jobs-guest/jobs/api/"
                f"seeMoreJobPostings/search"
                f"?keywords={keywords}"
                f"&location={location}"
                f"&start={offset}"
            )

            yield scrapy.Request(
                url=url,
                callback=self.parse,
                meta={
                    "page": page,
                    "offset": offset,
                },
                headers={
                    "Accept": "text/html",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )

    def parse(self, response: HtmlResponse, **kwargs: Any) -> Generator[JobItem, None, None]:
        if self._check_time_limit():
            return

        page = response.meta.get("page", 0)

        # LinkedIn guest API returns a list of <li> cards
        job_cards = response.css("li")

        if not job_cards:
            logger.info("No more results on page %d. Stopping.", page)
            return

        for card in job_cards:
            if self._check_time_limit():
                return

            if self.results_count >= self.max_results:
                logger.info("Reached max results (%d). Stopping.", self.max_results)
                return

            try:
                item = self._parse_card(card)
                if item:
                    self.results_count += 1
                    yield item
            except Exception as e:
                logger.warning("Error parsing LinkedIn job card: %s", e)
                continue

    def _parse_card(self, card: scrapy.Selector) -> JobItem | None:
        """Parse a single LinkedIn job card into a JobItem."""

        # Title and URL
        title_link = card.css("a.base-card__full-link")
        if not title_link:
            title_link = card.css("a[data-tracking-control-name='public_jobs_jserp-result_search-card']")
        if not title_link:
            title_link = card.css("a.result-card__full-card-link")

        if not title_link:
            return None

        url = title_link.attrib.get("href", "").strip()
        if not url:
            return None

        url = self.normalize_url(url)

        title = (
            card.css("h3.base-search-card__title::text").get("")
            or card.css("span.screen-reader-text::text").get("")
            or title_link.css("span::text").get("")
        ).strip()

        if not title:
            title = title_link.attrib.get("aria-label", "").strip()

        # Company
        company = (
            card.css("h4.base-search-card__subtitle a::text").get("")
            or card.css("a.hidden-nested-link::text").get("")
        ).strip()

        # Location
        location = (
            card.css("span.job-search-card__location::text").get("")
        ).strip()

        # Date
        date_elem = card.css("time")
        posted_date = ""
        if date_elem:
            posted_date = (
                date_elem.attrib.get("datetime", "")
                or date_elem.css("::text").get("")
            ).strip()

        # Salary (not always present on cards)
        salary_text = card.css(
            "span.job-search-card__salary-info::text"
        ).get("").strip()

        # Easy Apply badge
        easy_apply = bool(card.css("span.result-benefits__text::text").re(r"(?i)easy\s+apply"))

        # Extract external ID from URL
        external_id = self._extract_job_id(url)

        # Check for remote
        combined_text = f"{title} {location}"
        is_remote = self.extract_remote_flag(combined_text)

        # Parse salary
        salary_info = self.extract_salary(salary_text)

        item = JobItem(
            external_id=external_id,
            url=url,
            title=title,
            company=company,
            location=location,
            is_remote=is_remote,
            salary_min=salary_info["salary_min"],
            salary_max=salary_info["salary_max"],
            salary_text=salary_info["salary_text"],
            description_html="",  # Would need a detail page fetch for full description
            description_text="",
            posted_date=self.parse_date(posted_date) if posted_date else None,
            keywords=[],
            easy_apply=easy_apply,
            source_name="linkedin",
            raw_data={
                "card_html": card.get(),
            },
        )

        # Optionally fetch the full job detail page for description
        # This is done as a follow-up request
        if url and not url.startswith("javascript:"):
            return item

        return item

    @staticmethod
    def _extract_job_id(url: str) -> str:
        """Extract LinkedIn job ID from the URL."""
        # URLs look like: https://www.linkedin.com/jobs/view/1234567890
        match = re.search(r"/jobs/view/(\d+)", url)
        if match:
            return f"linkedin_{match.group(1)}"

        # Fallback: try query param
        match = re.search(r"currentJobId=(\d+)", url)
        if match:
            return f"linkedin_{match.group(1)}"

        return ""
