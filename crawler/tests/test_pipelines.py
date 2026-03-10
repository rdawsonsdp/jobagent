"""
Tests for the CleaningPipeline and DeduplicationPipeline.

Covers HTML stripping, whitespace normalization, date parsing,
URL hash computation, and fuzzy deduplication logic.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from jobcrawler.items import JobItem
from jobcrawler.pipelines import CleaningPipeline, DeduplicationPipeline


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def cleaning_pipeline() -> CleaningPipeline:
    return CleaningPipeline()


@pytest.fixture
def dedup_pipeline() -> DeduplicationPipeline:
    pipeline = DeduplicationPipeline()
    # Mock the Supabase DB so tests don't need a real connection
    pipeline.db = MagicMock()
    pipeline.db.check_url_hash_exists = MagicMock(return_value=False)
    pipeline.seen_title_company = set()
    return pipeline


@pytest.fixture
def mock_spider() -> MagicMock:
    spider = MagicMock()
    spider.name = "test_spider"
    return spider


def _make_item(**overrides: object) -> JobItem:
    """Create a JobItem with default values, overridden by kwargs."""
    defaults = {
        "external_id": "test_123",
        "url": "https://example.com/jobs/123",
        "title": "Software Engineer",
        "company": "Acme Corp",
        "location": "San Francisco, CA",
        "is_remote": None,
        "salary_min": None,
        "salary_max": None,
        "salary_text": None,
        "description_html": "<p>Great job at <b>Acme</b>!</p>",
        "description_text": "",
        "posted_date": None,
        "keywords": None,
        "easy_apply": None,
        "source_name": "test",
        "raw_data": {},
    }
    defaults.update(overrides)
    return JobItem(**defaults)


# ---------------------------------------------------------------------------
# CleaningPipeline tests
# ---------------------------------------------------------------------------

class TestCleaningPipeline:
    """Tests for the CleaningPipeline."""

    def test_strips_html_from_description(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(
            description_html="<p>Join our <b>team</b>!</p><ul><li>Python</li><li>Django</li></ul>"
        )
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert "<p>" not in result["description_text"]
        assert "<b>" not in result["description_text"]
        assert "Join our team!" in result["description_text"]
        assert "Python" in result["description_text"]
        assert "Django" in result["description_text"]

    def test_normalizes_whitespace(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(
            description_html="<p>  Too   many    spaces  </p>",
            title="  Senior   Engineer  ",
            company="  Acme   Corp  ",
        )
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["description_text"] == "Too many spaces"
        assert result["title"] == "Senior Engineer"
        assert result["company"] == "Acme Corp"

    def test_handles_empty_html(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(description_html="", description_text="Existing text")
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["description_text"] == "Existing text"

    def test_handles_none_html(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(description_html=None, description_text="")
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["description_text"] == ""

    def test_date_already_formatted(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="2025-03-15")
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["posted_date"] == "2025-03-15"

    def test_date_relative_days_ago(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="3 days ago")
        result = cleaning_pipeline.process_item(item, mock_spider)
        expected = (datetime.utcnow() - timedelta(days=3)).strftime("%Y-%m-%d")
        assert result["posted_date"] == expected

    def test_date_relative_weeks_ago(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="2 weeks ago")
        result = cleaning_pipeline.process_item(item, mock_spider)
        expected = (datetime.utcnow() - timedelta(weeks=2)).strftime("%Y-%m-%d")
        assert result["posted_date"] == expected

    def test_date_today(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="today")
        result = cleaning_pipeline.process_item(item, mock_spider)
        expected = datetime.utcnow().strftime("%Y-%m-%d")
        assert result["posted_date"] == expected

    def test_date_just_posted(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="Just posted")
        result = cleaning_pipeline.process_item(item, mock_spider)
        expected = datetime.utcnow().strftime("%Y-%m-%d")
        assert result["posted_date"] == expected

    def test_date_absolute_format(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="March 15, 2025")
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["posted_date"] == "2025-03-15"

    def test_date_slash_format(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="03/15/2025")
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["posted_date"] == "2025-03-15"

    def test_date_unparseable_returns_none(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date="not a real date")
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["posted_date"] is None

    def test_date_none_stays_none(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(posted_date=None)
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result.get("posted_date") is None

    def test_defaults_is_remote_to_false(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(is_remote=None)
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["is_remote"] is False

    def test_defaults_easy_apply_to_false(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(easy_apply=None)
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["easy_apply"] is False

    def test_defaults_keywords_to_empty_list(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(keywords=None)
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["keywords"] == []

    def test_preserves_existing_values(
        self, cleaning_pipeline: CleaningPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(
            is_remote=True,
            easy_apply=True,
            keywords=["python", "django"],
        )
        result = cleaning_pipeline.process_item(item, mock_spider)
        assert result["is_remote"] is True
        assert result["easy_apply"] is True
        assert result["keywords"] == ["python", "django"]


# ---------------------------------------------------------------------------
# DeduplicationPipeline tests
# ---------------------------------------------------------------------------

class TestDeduplicationPipeline:
    """Tests for the DeduplicationPipeline."""

    def test_computes_url_hash(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        item = _make_item(url="https://example.com/jobs/123")
        result = dedup_pipeline.process_item(item, mock_spider)
        assert "url_hash" in result
        assert len(result["url_hash"]) == 64  # SHA256 hex digest

    def test_url_hash_is_deterministic(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        item1 = _make_item(url="https://example.com/jobs/123")
        item2 = _make_item(url="https://example.com/jobs/123", title="Different Title")
        result1 = dedup_pipeline.process_item(item1, mock_spider)

        # Reset seen set to avoid fuzzy dedup on same title
        dedup_pipeline.seen_title_company = set()
        result2 = dedup_pipeline.process_item(item2, mock_spider)

        assert result1["url_hash"] == result2["url_hash"]

    def test_strips_tracking_params_from_url_hash(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        item1 = _make_item(url="https://example.com/jobs/123")
        item2 = _make_item(
            url="https://example.com/jobs/123?utm_source=google&utm_medium=cpc",
            title="Different Title",
            company="Different Company",
        )
        result1 = dedup_pipeline.process_item(item1, mock_spider)
        result2 = dedup_pipeline.process_item(item2, mock_spider)
        assert result1["url_hash"] == result2["url_hash"]

    def test_drops_duplicate_url_hash_from_db(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        # Simulate URL hash already existing in Supabase
        dedup_pipeline.db.check_url_hash_exists = MagicMock(return_value=True)

        from scrapy.exceptions import DropItem

        item = _make_item(url="https://example.com/jobs/123")
        with pytest.raises(DropItem, match="Duplicate URL hash"):
            dedup_pipeline.process_item(item, mock_spider)

    def test_passes_new_url_hash(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        dedup_pipeline.db.check_url_hash_exists = MagicMock(return_value=False)

        item = _make_item(url="https://example.com/jobs/new-job")
        result = dedup_pipeline.process_item(item, mock_spider)
        assert result is not None
        assert result["url"] == "https://example.com/jobs/new-job"

    def test_drops_fuzzy_duplicate_title_company(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        from scrapy.exceptions import DropItem

        item1 = _make_item(
            url="https://site-a.com/job/1",
            title="Senior Software Engineer",
            company="Acme Corp",
        )
        item2 = _make_item(
            url="https://site-b.com/job/2",
            title="Senior Software Engineer",
            company="Acme Corp",
        )

        # First item passes
        dedup_pipeline.process_item(item1, mock_spider)

        # Second item with same title+company should be dropped
        with pytest.raises(DropItem, match="Fuzzy duplicate"):
            dedup_pipeline.process_item(item2, mock_spider)

    def test_passes_different_title_same_company(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        item1 = _make_item(
            url="https://example.com/job/1",
            title="Software Engineer",
            company="Acme Corp",
        )
        item2 = _make_item(
            url="https://example.com/job/2",
            title="Product Manager",
            company="Acme Corp",
        )

        dedup_pipeline.process_item(item1, mock_spider)
        result = dedup_pipeline.process_item(item2, mock_spider)
        assert result is not None

    def test_normalizes_company_suffixes_for_fuzzy_match(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        from scrapy.exceptions import DropItem

        item1 = _make_item(
            url="https://example.com/job/1",
            title="Engineer",
            company="Acme Inc.",
        )
        item2 = _make_item(
            url="https://example.com/job/2",
            title="Engineer",
            company="Acme",
        )

        dedup_pipeline.process_item(item1, mock_spider)

        with pytest.raises(DropItem, match="Fuzzy duplicate"):
            dedup_pipeline.process_item(item2, mock_spider)

    def test_missing_url_raises_drop_item(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        from scrapy.exceptions import DropItem

        item = _make_item(url="")
        with pytest.raises(DropItem, match="Missing URL"):
            dedup_pipeline.process_item(item, mock_spider)

    def test_continues_on_db_error(
        self, dedup_pipeline: DeduplicationPipeline, mock_spider: MagicMock
    ) -> None:
        """If the DB check fails, the pipeline should continue (not drop)."""
        dedup_pipeline.db.check_url_hash_exists = MagicMock(
            side_effect=Exception("DB connection lost")
        )

        item = _make_item(url="https://example.com/job/1")
        result = dedup_pipeline.process_item(item, mock_spider)
        assert result is not None

    def test_normalize_url_removes_fragments(
        self,
    ) -> None:
        result = DeduplicationPipeline._normalize_url(
            "https://example.com/jobs/123#apply"
        )
        assert "#" not in result

    def test_normalize_url_lowercases(
        self,
    ) -> None:
        result = DeduplicationPipeline._normalize_url(
            "HTTPS://EXAMPLE.COM/Jobs/123"
        )
        assert "EXAMPLE" not in result
        assert "example.com" in result
