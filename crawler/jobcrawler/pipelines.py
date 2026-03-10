"""
Scrapy item pipelines for the jobcrawler.

Pipeline stages (by priority):
  100 - CleaningPipeline: HTML stripping, whitespace normalization, date standardization
  200 - DeduplicationPipeline: URL hash dedup + fuzzy title+company dedup
  300 - ClaudeScorePipeline: AI-based relevance scoring via Anthropic API
  400 - SupabaseWritePipeline: Persist jobs to Supabase
  500 - AutoApplyDetectPipeline: Queue high-scoring easy-apply jobs
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, date
from typing import Any

from bs4 import BeautifulSoup
from scrapy import Spider
from scrapy.exceptions import DropItem

from jobcrawler.items import JobItem
from jobcrawler.ai.claude_client import ClaudeClient
from jobcrawler.ai.cover_letter import generate_cover_letter
from jobcrawler.db.supabase_client import SupabaseDB

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 100 - CleaningPipeline
# ---------------------------------------------------------------------------

class CleaningPipeline:
    """
    Strips HTML from description_html to produce description_text,
    normalizes whitespace, and standardizes posted_date to YYYY-MM-DD.
    """

    # Common relative date patterns
    RELATIVE_DATE_PATTERNS = [
        (re.compile(r"(\d+)\s*minute", re.IGNORECASE), "minutes"),
        (re.compile(r"(\d+)\s*hour", re.IGNORECASE), "hours"),
        (re.compile(r"(\d+)\s*day", re.IGNORECASE), "days"),
        (re.compile(r"(\d+)\s*week", re.IGNORECASE), "weeks"),
        (re.compile(r"(\d+)\s*month", re.IGNORECASE), "months"),
    ]

    # Common absolute date formats to try
    DATE_FORMATS = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%B %d, %Y",
        "%b %d, %Y",
        "%d %B %Y",
        "%d %b %Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
    ]

    def process_item(self, item: JobItem, spider: Spider) -> JobItem:
        # Strip HTML to plain text
        description_html = item.get("description_html", "") or ""
        if description_html:
            soup = BeautifulSoup(description_html, "html.parser")
            text = soup.get_text(separator=" ", strip=True)
        else:
            text = item.get("description_text", "") or ""

        # Normalize whitespace: collapse runs of whitespace into single spaces
        text = re.sub(r"\s+", " ", text).strip()
        item["description_text"] = text

        # Standardize title and company
        if item.get("title"):
            item["title"] = re.sub(r"\s+", " ", item["title"]).strip()
        if item.get("company"):
            item["company"] = re.sub(r"\s+", " ", item["company"]).strip()

        # Normalize location
        if item.get("location"):
            item["location"] = re.sub(r"\s+", " ", item["location"]).strip()

        # Standardize posted_date to YYYY-MM-DD
        raw_date = item.get("posted_date")
        if raw_date:
            item["posted_date"] = self._normalize_date(raw_date)

        # Default is_remote to False if not set
        if item.get("is_remote") is None:
            item["is_remote"] = False

        # Default easy_apply to False if not set
        if item.get("easy_apply") is None:
            item["easy_apply"] = False

        # Ensure keywords is a list
        if item.get("keywords") is None:
            item["keywords"] = []

        logger.debug("Cleaned item: %s at %s", item.get("title"), item.get("company"))
        return item

    def _normalize_date(self, raw_date: str) -> str | None:
        """Attempt to parse a date string into YYYY-MM-DD format."""
        if not raw_date:
            return None

        raw_date = raw_date.strip()

        # Already in YYYY-MM-DD format
        if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date):
            return raw_date

        # Try relative date patterns ("3 days ago", "1 week ago")
        from datetime import timedelta

        for pattern, unit in self.RELATIVE_DATE_PATTERNS:
            match = pattern.search(raw_date)
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
                result_date = now - delta
                return result_date.strftime("%Y-%m-%d")

        # "today" / "just posted"
        lower = raw_date.lower()
        if lower in ("today", "just posted", "just now"):
            return datetime.utcnow().strftime("%Y-%m-%d")

        # Try absolute formats
        for fmt in self.DATE_FORMATS:
            try:
                parsed = datetime.strptime(raw_date, fmt)
                return parsed.strftime("%Y-%m-%d")
            except ValueError:
                continue

        logger.warning("Could not parse date: %s", raw_date)
        return None


# ---------------------------------------------------------------------------
# 200 - DeduplicationPipeline
# ---------------------------------------------------------------------------

class DeduplicationPipeline:
    """
    Deduplicates jobs using:
    1. SHA256 hash of the normalized URL checked against Supabase jobs.url_hash
    2. Fuzzy match on normalized title + company within the current crawl session
    """

    def __init__(self) -> None:
        self.db: SupabaseDB | None = None
        self.seen_title_company: set[str] = set()

    def open_spider(self, spider: Spider) -> None:
        self.db = SupabaseDB()
        self.seen_title_company = set()

    def process_item(self, item: JobItem, spider: Spider) -> JobItem:
        url = item.get("url", "")
        if not url:
            raise DropItem("Missing URL -- cannot deduplicate")

        # Compute URL hash
        normalized_url = self._normalize_url(url)
        url_hash = hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()
        item["url_hash"] = url_hash

        # Check Supabase for existing url_hash
        try:
            if self.db and self.db.check_url_hash_exists(url_hash):
                raise DropItem(f"Duplicate URL hash: {url_hash} ({url})")
        except DropItem:
            raise
        except Exception as e:
            logger.warning("Error checking url_hash in Supabase: %s", e)
            # Continue processing if DB check fails

        # Fuzzy dedup on title + company within session
        title = (item.get("title") or "").lower().strip()
        company = (item.get("company") or "").lower().strip()
        if title and company:
            title_company_key = self._fuzzy_key(title, company)
            if title_company_key in self.seen_title_company:
                raise DropItem(
                    f"Fuzzy duplicate: '{item.get('title')}' at '{item.get('company')}'"
                )
            self.seen_title_company.add(title_company_key)

        return item

    @staticmethod
    def _normalize_url(url: str) -> str:
        """Normalize URL for consistent hashing."""
        from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

        parsed = urlparse(url.strip().lower())
        # Remove tracking params
        tracking_params = {
            "utm_source", "utm_medium", "utm_campaign", "utm_term",
            "utm_content", "ref", "refId", "trackingId",
        }
        params = parse_qs(parsed.query)
        filtered = {k: v for k, v in params.items() if k not in tracking_params}
        clean_query = urlencode(filtered, doseq=True)
        normalized = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip("/"),
            parsed.params,
            clean_query,
            "",  # drop fragment
        ))
        return normalized

    @staticmethod
    def _fuzzy_key(title: str, company: str) -> str:
        """
        Create a normalized key from title + company for fuzzy matching.
        Strips common suffixes like 'Inc', 'LLC', 'Corp' and normalizes whitespace.
        """
        # Remove common company suffixes
        company_clean = re.sub(
            r"\b(inc|llc|ltd|corp|corporation|co|company|group|holdings)\b\.?",
            "",
            company,
            flags=re.IGNORECASE,
        ).strip()

        # Remove special characters
        title_clean = re.sub(r"[^a-z0-9\s]", "", title)
        company_clean = re.sub(r"[^a-z0-9\s]", "", company_clean)

        # Collapse whitespace
        title_clean = re.sub(r"\s+", " ", title_clean).strip()
        company_clean = re.sub(r"\s+", " ", company_clean).strip()

        return f"{title_clean}||{company_clean}"


# ---------------------------------------------------------------------------
# 300 - ClaudeScorePipeline
# ---------------------------------------------------------------------------

class ClaudeScorePipeline:
    """
    Batches jobs (up to 5 at a time) and scores them via Claude against
    the active resume. Adds relevance_score, score_reasoning,
    keywords_matched, and keywords_missing to each item.
    """

    BATCH_SIZE = 5

    def __init__(self) -> None:
        self.claude: ClaudeClient | None = None
        self.db: SupabaseDB | None = None
        self.resume_data: dict[str, Any] | None = None
        self.batch: list[JobItem] = []

    def open_spider(self, spider: Spider) -> None:
        self.claude = ClaudeClient()
        self.db = SupabaseDB()
        self.batch = []

        # Load active resume
        try:
            resume = self.db.get_active_resume()
            if resume and resume.get("parsed_data"):
                self.resume_data = resume["parsed_data"]
                logger.info("Loaded active resume for scoring")
            else:
                logger.warning(
                    "No active resume with parsed_data found. "
                    "Scoring will be skipped."
                )
        except Exception as e:
            logger.error("Failed to load active resume: %s", e)

    def process_item(self, item: JobItem, spider: Spider) -> JobItem:
        if not self.resume_data:
            # No resume to score against -- pass through with default score
            item["relevance_score"] = 0.0
            item["score_reasoning"] = "No active resume available for scoring"
            item["keywords_matched"] = []
            item["keywords_missing"] = []
            return item

        # Score each item inline so the score is available before DB write
        self.batch.append(item)

        if len(self.batch) >= self.BATCH_SIZE:
            self._score_batch()
            return item

        # Don't wait for batch — score immediately for correctness
        # (items pass to SupabaseWritePipeline right after this returns)
        self._score_batch()
        return item

    def close_spider(self, spider: Spider) -> None:
        # Score any remaining items in the batch
        if self.batch:
            self._score_batch()

    def _score_batch(self) -> None:
        """Score the current batch of items and clear it."""
        if not self.claude or not self.resume_data:
            for item in self.batch:
                item["relevance_score"] = 0.0
                item["score_reasoning"] = "Scoring unavailable"
                item["keywords_matched"] = []
                item["keywords_missing"] = []
            self.batch = []
            return

        try:
            jobs_data = []
            for item in self.batch:
                jobs_data.append({
                    "title": item.get("title", ""),
                    "company": item.get("company", ""),
                    "location": item.get("location", ""),
                    "description": item.get("description_text", "")[:3000],
                    "keywords": item.get("keywords", []),
                    "is_remote": item.get("is_remote", False),
                    "salary_text": item.get("salary_text", ""),
                })

            scores = self.claude.score_jobs(jobs_data, self.resume_data)

            for i, item in enumerate(self.batch):
                if i < len(scores):
                    score_data = scores[i]
                    item["relevance_score"] = score_data.get("score", 0.0)
                    item["score_reasoning"] = score_data.get("reasoning", "")
                    item["keywords_matched"] = score_data.get("keywords_matched", [])
                    item["keywords_missing"] = score_data.get("keywords_missing", [])
                    logger.info(
                        "Scored '%s' at '%s': %.1f/10",
                        item.get("title"),
                        item.get("company"),
                        item["relevance_score"],
                    )
                else:
                    item["relevance_score"] = 0.0
                    item["score_reasoning"] = "Scoring response incomplete"
                    item["keywords_matched"] = []
                    item["keywords_missing"] = []

        except Exception as e:
            logger.error("Error scoring batch: %s", e)
            for item in self.batch:
                item["relevance_score"] = 0.0
                item["score_reasoning"] = f"Scoring error: {str(e)}"
                item["keywords_matched"] = []
                item["keywords_missing"] = []

        self.batch = []


# ---------------------------------------------------------------------------
# 400 - SupabaseWritePipeline
# ---------------------------------------------------------------------------

class SupabaseWritePipeline:
    """
    Inserts the job into the Supabase 'jobs' table with all fields
    including url_hash, relevance_score, and score_reasoning.
    Resolves source_id from source_name.
    """

    def __init__(self) -> None:
        self.db: SupabaseDB | None = None
        self.source_cache: dict[str, str] = {}

    def open_spider(self, spider: Spider) -> None:
        self.db = SupabaseDB()
        self._load_source_cache()

    def _load_source_cache(self) -> None:
        """Pre-load source name -> id mapping."""
        try:
            if self.db:
                sources = self.db.get_job_sources()
                for source in sources:
                    name = source.get("name", "").lower()
                    source_id = source.get("id")
                    if name and source_id:
                        self.source_cache[name] = source_id
                logger.info("Loaded %d job sources", len(self.source_cache))
        except Exception as e:
            logger.error("Failed to load job sources: %s", e)

    def process_item(self, item: JobItem, spider: Spider) -> JobItem:
        if not self.db:
            logger.error("Supabase client not initialized, skipping write")
            return item

        # Resolve source_id
        source_name = (item.get("source_name") or "").lower()
        source_id = self.source_cache.get(source_name)
        if source_id:
            item["source_id"] = source_id

        # Build the record for insertion
        job_data: dict[str, Any] = {
            "external_id": item.get("external_id"),
            "url": item.get("url"),
            "url_hash": item.get("url_hash"),
            "title": item.get("title"),
            "company": item.get("company"),
            "location": item.get("location"),
            "is_remote": item.get("is_remote", False),
            "salary_min": item.get("salary_min"),
            "salary_max": item.get("salary_max"),
            "salary_text": item.get("salary_text"),
            "description_html": item.get("description_html"),
            "description_text": item.get("description_text"),
            "posted_date": item.get("posted_date"),
            "keywords": item.get("keywords", []),
            "easy_apply": item.get("easy_apply", False),
            "source_id": item.get("source_id"),
            "relevance_score": item.get("relevance_score", 0.0),
            "score_reasoning": item.get("score_reasoning"),
            "raw_data": {
                "keywords_matched": item.get("keywords_matched", []),
                "keywords_missing": item.get("keywords_missing", []),
            },
        }

        # Remove None values to let DB defaults apply
        job_data = {k: v for k, v in job_data.items() if v is not None}

        try:
            result = self.db.insert_job(job_data)
            # Store the DB id back into the item for downstream pipelines
            if result and result.get("id"):
                item["db_id"] = result["id"]
            logger.info(
                "Inserted job: '%s' at '%s' (score: %.1f)",
                item.get("title"),
                item.get("company"),
                item.get("relevance_score", 0.0),
            )
        except Exception as e:
            logger.error(
                "Failed to insert job '%s' at '%s': %s",
                item.get("title"),
                item.get("company"),
                e,
            )

        return item


# ---------------------------------------------------------------------------
# 500 - AutoApplyDetectPipeline
# ---------------------------------------------------------------------------

class AutoApplyDetectPipeline:
    """
    If a job has easy_apply=True and relevance_score >= 7.0,
    generates a cover letter draft via Claude and inserts the
    job into the auto_apply_queue for review.
    """

    SCORE_THRESHOLD = 7.0

    def __init__(self) -> None:
        self.db: SupabaseDB | None = None
        self.claude: ClaudeClient | None = None
        self.resume_data: dict[str, Any] | None = None

    def open_spider(self, spider: Spider) -> None:
        self.db = SupabaseDB()
        self.claude = ClaudeClient()

        try:
            resume = self.db.get_active_resume()
            if resume and resume.get("parsed_data"):
                self.resume_data = resume["parsed_data"]
        except Exception as e:
            logger.error("Failed to load resume for cover letter generation: %s", e)

    def process_item(self, item: JobItem, spider: Spider) -> JobItem:
        easy_apply = item.get("easy_apply", False)
        relevance_score = item.get("relevance_score", 0.0)

        if not easy_apply or relevance_score < self.SCORE_THRESHOLD:
            return item

        if not self.db or not self.claude or not self.resume_data:
            logger.warning(
                "Auto-apply detection skipped for '%s' -- missing dependencies",
                item.get("title"),
            )
            return item

        logger.info(
            "Auto-apply candidate: '%s' at '%s' (score: %.1f)",
            item.get("title"),
            item.get("company"),
            relevance_score,
        )

        # Generate cover letter draft
        cover_letter = ""
        try:
            job_data = {
                "title": item.get("title", ""),
                "company": item.get("company", ""),
                "description": item.get("description_text", "")[:3000],
                "location": item.get("location", ""),
                "keywords_matched": item.get("keywords_matched", []),
            }
            cover_letter = generate_cover_letter(
                self.claude, job_data, self.resume_data
            )
        except Exception as e:
            logger.error("Failed to generate cover letter: %s", e)
            cover_letter = ""

        # Insert into auto_apply_queue (requires job_id from DB insert)
        job_id = item.get("db_id")
        if not job_id:
            logger.warning(
                "No db_id for '%s' -- cannot queue auto-apply",
                item.get("title"),
            )
            return item

        try:
            apply_data = {
                "job_id": job_id,
                "cover_letter_draft": cover_letter,
                "status": "pending_review",
            }
            self.db.insert_auto_apply(apply_data)
            logger.info(
                "Queued auto-apply for '%s' at '%s'",
                item.get("title"),
                item.get("company"),
            )
        except Exception as e:
            logger.error(
                "Failed to queue auto-apply for '%s': %s",
                item.get("title"),
                e,
            )

        return item
