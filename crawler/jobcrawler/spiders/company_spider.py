"""
Generic company career page spider.

Configurable via the job_sources table in Supabase. Supports:
  - Greenhouse API (boards.greenhouse.io)
  - Lever API (jobs.lever.co)
  - Generic career page scraping via CSS selectors

Each source record in the DB provides the base URL and source type,
and this spider dispatches to the appropriate parser.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Generator
from urllib.parse import urljoin

import scrapy
from scrapy.http import HtmlResponse, TextResponse

from jobcrawler.items import JobItem
from jobcrawler.spiders.base_spider import BaseJobSpider
from jobcrawler.db.supabase_client import SupabaseDB

logger = logging.getLogger(__name__)


class CompanySpider(BaseJobSpider):
    """
    Configurable spider for company career pages.

    Reads source configurations from the Supabase job_sources table
    and dispatches to Greenhouse, Lever, or generic career page parsers.
    """

    name = "company"
    allowed_domains: list[str] = []  # Set dynamically from sources

    custom_settings = {
        "DOWNLOAD_DELAY": 5,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.sources: list[dict[str, Any]] = []
        self.source_filter: str = kwargs.get("source_filter", "")  # comma-separated source names

    def start_requests(self) -> Generator[scrapy.Request, None, None]:
        self._start_time = time.time()

        # Load sources from Supabase
        try:
            db = SupabaseDB()
            all_sources = db.get_job_sources()

            # Filter to company-type sources (exclude linkedin, indeed, etc.)
            self.sources = [
                s for s in all_sources
                if s.get("source_type") in ("greenhouse", "lever", "career_page")
                and s.get("is_active", True)
            ]

            # Apply source filter if specified
            if self.source_filter:
                filter_names = {n.strip().lower() for n in self.source_filter.split(",")}
                self.sources = [
                    s for s in self.sources
                    if s.get("name", "").lower() in filter_names
                ]

            logger.info("Loaded %d company sources to crawl", len(self.sources))
        except Exception as e:
            logger.error("Failed to load job sources from Supabase: %s", e)
            return

        for source in self.sources:
            if self._check_time_limit():
                break

            source_type = source.get("source_type", "")
            base_url = source.get("base_url", "")
            source_name = source.get("name", "")

            if not base_url:
                logger.warning("Source '%s' has no base_url, skipping", source_name)
                continue

            logger.info("Starting crawl for source: %s (%s)", source_name, source_type)

            if source_type == "greenhouse":
                yield from self._greenhouse_requests(source)
            elif source_type == "lever":
                yield from self._lever_requests(source)
            elif source_type == "career_page":
                yield from self._career_page_requests(source)
            else:
                logger.warning("Unknown source type '%s' for '%s'", source_type, source_name)

    # ------------------------------------------------------------------
    # Greenhouse
    # ------------------------------------------------------------------

    def _greenhouse_requests(self, source: dict[str, Any]) -> Generator[scrapy.Request, None, None]:
        """
        Greenhouse boards expose a JSON API at:
        https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
        """
        base_url = source.get("base_url", "")
        # Extract board token from URL like boards.greenhouse.io/company
        board_token = base_url.rstrip("/").split("/")[-1]

        api_url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true"

        yield scrapy.Request(
            url=api_url,
            callback=self.parse_greenhouse,
            meta={"source": source},
            headers={"Accept": "application/json"},
        )

    def parse_greenhouse(self, response: TextResponse, **kwargs: Any) -> Generator[Any, None, None]:
        """Parse Greenhouse API response."""
        if self._check_time_limit():
            return

        source = response.meta["source"]
        source_name = source.get("name", "greenhouse")

        try:
            data = json.loads(response.text)
        except json.JSONDecodeError:
            logger.error("Failed to parse Greenhouse JSON for '%s'", source_name)
            return

        jobs = data.get("jobs", [])
        logger.info("Found %d jobs from Greenhouse source '%s'", len(jobs), source_name)

        for job in jobs:
            if self._check_time_limit():
                return

            try:
                item = self._parse_greenhouse_job(job, source)
                if item:
                    yield item
            except Exception as e:
                logger.warning("Error parsing Greenhouse job: %s", e)
                continue

    def _parse_greenhouse_job(self, job: dict[str, Any], source: dict[str, Any]) -> JobItem | None:
        """Parse a single Greenhouse job object."""
        job_id = job.get("id", "")
        title = job.get("title", "").strip()
        url = job.get("absolute_url", "")

        if not title or not url:
            return None

        url = self.normalize_url(url)

        # Location
        location_data = job.get("location", {})
        location = location_data.get("name", "") if isinstance(location_data, dict) else ""

        # Description
        description_html = job.get("content", "")

        # Departments/keywords
        departments = [d.get("name", "") for d in job.get("departments", [])]

        # Posted date
        updated_at = job.get("updated_at", "")

        # Company name from source
        company = source.get("company_name", source.get("name", ""))

        is_remote = self.extract_remote_flag(f"{title} {location}")
        salary_info = self.extract_salary(description_html)

        return JobItem(
            external_id=f"greenhouse_{job_id}",
            url=url,
            title=title,
            company=company,
            location=location,
            is_remote=is_remote,
            salary_min=salary_info["salary_min"],
            salary_max=salary_info["salary_max"],
            salary_text=salary_info["salary_text"],
            description_html=description_html,
            description_text="",
            posted_date=self.parse_date(updated_at) if updated_at else None,
            keywords=departments,
            easy_apply=False,
            source_name=source.get("name", "greenhouse"),
            raw_data=job,
        )

    # ------------------------------------------------------------------
    # Lever
    # ------------------------------------------------------------------

    def _lever_requests(self, source: dict[str, Any]) -> Generator[scrapy.Request, None, None]:
        """
        Lever exposes a JSON API at:
        https://api.lever.co/v0/postings/{company}?mode=json
        """
        base_url = source.get("base_url", "")
        # Extract company slug from URL like jobs.lever.co/company
        company_slug = base_url.rstrip("/").split("/")[-1]

        api_url = f"https://api.lever.co/v0/postings/{company_slug}?mode=json"

        yield scrapy.Request(
            url=api_url,
            callback=self.parse_lever,
            meta={"source": source},
            headers={"Accept": "application/json"},
        )

    def parse_lever(self, response: TextResponse, **kwargs: Any) -> Generator[Any, None, None]:
        """Parse Lever API response."""
        if self._check_time_limit():
            return

        source = response.meta["source"]
        source_name = source.get("name", "lever")

        try:
            jobs = json.loads(response.text)
        except json.JSONDecodeError:
            logger.error("Failed to parse Lever JSON for '%s'", source_name)
            return

        if not isinstance(jobs, list):
            logger.error("Lever response is not a list for '%s'", source_name)
            return

        logger.info("Found %d jobs from Lever source '%s'", len(jobs), source_name)

        for job in jobs:
            if self._check_time_limit():
                return

            try:
                item = self._parse_lever_job(job, source)
                if item:
                    yield item
            except Exception as e:
                logger.warning("Error parsing Lever job: %s", e)
                continue

    def _parse_lever_job(self, job: dict[str, Any], source: dict[str, Any]) -> JobItem | None:
        """Parse a single Lever job posting object."""
        job_id = job.get("id", "")
        title = job.get("text", "").strip()
        url = job.get("hostedUrl", "") or job.get("applyUrl", "")

        if not title or not url:
            return None

        url = self.normalize_url(url)

        # Location
        categories = job.get("categories", {})
        location = categories.get("location", "")

        # Description
        description_html = job.get("descriptionPlain", "") or job.get("description", "")
        additional_html = job.get("additionalPlain", "") or job.get("additional", "")
        if additional_html:
            description_html = f"{description_html}\n\n{additional_html}"

        # Lists (requirements, etc.)
        lists = job.get("lists", [])
        for lst in lists:
            list_text = lst.get("text", "")
            list_content = lst.get("content", "")
            if list_text and list_content:
                description_html += f"\n\n{list_text}\n{list_content}"

        # Keywords from categories
        keywords = []
        if categories.get("team"):
            keywords.append(categories["team"])
        if categories.get("department"):
            keywords.append(categories["department"])
        if categories.get("commitment"):
            keywords.append(categories["commitment"])

        # Date
        created_at = job.get("createdAt")
        posted_date = None
        if created_at:
            try:
                from datetime import datetime
                # Lever uses millisecond timestamps
                dt = datetime.utcfromtimestamp(created_at / 1000)
                posted_date = dt.strftime("%Y-%m-%d")
            except (ValueError, TypeError, OSError):
                pass

        company = source.get("company_name", source.get("name", ""))
        is_remote = self.extract_remote_flag(f"{title} {location}")
        salary_info = self.extract_salary(description_html)

        return JobItem(
            external_id=f"lever_{job_id}",
            url=url,
            title=title,
            company=company,
            location=location,
            is_remote=is_remote,
            salary_min=salary_info["salary_min"],
            salary_max=salary_info["salary_max"],
            salary_text=salary_info["salary_text"],
            description_html=description_html,
            description_text="",
            posted_date=posted_date,
            keywords=keywords,
            easy_apply=False,
            source_name=source.get("name", "lever"),
            raw_data=job,
        )

    # ------------------------------------------------------------------
    # Generic career page
    # ------------------------------------------------------------------

    def _career_page_requests(self, source: dict[str, Any]) -> Generator[scrapy.Request, None, None]:
        """Generate requests for generic career page scraping."""
        base_url = source.get("base_url", "")
        config = source.get("scrape_config", {}) or {}

        # Determine if we need Playwright for JS-rendered pages
        use_playwright = config.get("use_playwright", False)

        meta: dict[str, Any] = {"source": source}
        if use_playwright:
            meta["playwright"] = True
            meta["playwright_include_page"] = False

        yield scrapy.Request(
            url=base_url,
            callback=self.parse_career_page,
            meta=meta,
            headers={
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )

    def parse_career_page(self, response: HtmlResponse, **kwargs: Any) -> Generator[Any, None, None]:
        """Parse a generic career page using configurable CSS selectors."""
        if self._check_time_limit():
            return

        source = response.meta["source"]
        source_name = source.get("name", "career_page")
        config = source.get("scrape_config", {}) or {}

        # Default selectors (can be overridden per source)
        job_card_selector = config.get("job_card_selector", "div.job-listing, li.job-item, div.position, tr.job-row")
        title_selector = config.get("title_selector", "a::text, h3::text, h2::text, .job-title::text")
        link_selector = config.get("link_selector", "a::attr(href)")
        location_selector = config.get("location_selector", ".location::text, .job-location::text")
        department_selector = config.get("department_selector", ".department::text, .job-department::text")

        job_cards = response.css(job_card_selector)

        if not job_cards:
            logger.info("No job cards found on career page '%s'", source_name)
            return

        logger.info("Found %d job cards on career page '%s'", len(job_cards), source_name)
        company = source.get("company_name", source.get("name", ""))

        for card in job_cards:
            if self._check_time_limit():
                return

            try:
                title = card.css(title_selector).get("").strip()
                link = card.css(link_selector).get("")
                location = card.css(location_selector).get("").strip()
                department = card.css(department_selector).get("").strip()

                if not title or not link:
                    continue

                url = urljoin(response.url, link)
                url = self.normalize_url(url)
                is_remote = self.extract_remote_flag(f"{title} {location}")

                # Generate a deterministic external ID
                import hashlib
                ext_hash = hashlib.md5(url.encode()).hexdigest()[:12]
                external_id = f"career_{ext_hash}"

                keywords = [department] if department else []

                item = JobItem(
                    external_id=external_id,
                    url=url,
                    title=title,
                    company=company,
                    location=location,
                    is_remote=is_remote,
                    salary_min=None,
                    salary_max=None,
                    salary_text=None,
                    description_html="",
                    description_text="",
                    posted_date=None,
                    keywords=keywords,
                    easy_apply=False,
                    source_name=source_name,
                    raw_data={"card_html": card.get()},
                )

                # Optionally follow the link to get full description
                if config.get("follow_detail_page", True):
                    yield scrapy.Request(
                        url=url,
                        callback=self.parse_career_detail,
                        meta={
                            "item": item,
                            "source": source,
                            "playwright": config.get("use_playwright", False),
                        },
                    )
                else:
                    yield item

            except Exception as e:
                logger.warning("Error parsing career page card: %s", e)
                continue

    def parse_career_detail(self, response: HtmlResponse, **kwargs: Any) -> Generator[JobItem, None, None]:
        """Parse a job detail page on a career site."""
        item: JobItem = response.meta["item"]
        source = response.meta["source"]
        config = source.get("scrape_config", {}) or {}

        description_selector = config.get(
            "description_selector",
            "div.job-description, div.content, div#job-description, "
            "div.job-details, article, main"
        )

        description_html = response.css(description_selector).get("")

        if description_html:
            item["description_html"] = description_html

            # Try to extract salary from the full description
            salary_info = self.extract_salary(description_html)
            if salary_info["salary_min"]:
                item["salary_min"] = salary_info["salary_min"]
                item["salary_max"] = salary_info["salary_max"]
                item["salary_text"] = salary_info["salary_text"]

        yield item
