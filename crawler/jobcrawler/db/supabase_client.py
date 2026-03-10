"""
Supabase client wrapper for the job crawler.

Provides typed methods for all database operations needed by the
crawler pipelines, spiders, and orchestrator.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Load environment variables from multiple possible locations
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "crawler", ".env"))


class SupabaseDB:
    """
    Supabase database client wrapper.

    Provides methods for all CRUD operations used throughout the crawler:
    jobs, resumes, search profiles, job sources, crawl runs, and auto-apply queue.
    """

    def __init__(
        self,
        url: str | None = None,
        key: str | None = None,
    ) -> None:
        self.url = url or os.getenv("SUPABASE_URL", "")
        self.key = key or os.getenv("SUPABASE_SERVICE_KEY", "")

        if not self.url or not self.key:
            logger.warning(
                "SUPABASE_URL or SUPABASE_SERVICE_KEY not set. "
                "Database operations will fail."
            )

        self._client: Client | None = None

    def get_client(self) -> Client:
        """Get or create the Supabase client (lazy initialization)."""
        if self._client is None:
            if not self.url or not self.key:
                raise RuntimeError(
                    "Cannot create Supabase client: "
                    "SUPABASE_URL or SUPABASE_SERVICE_KEY not configured"
                )
            self._client = create_client(self.url, self.key)
        return self._client

    # ------------------------------------------------------------------
    # Jobs
    # ------------------------------------------------------------------

    def insert_job(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Insert a job record into the jobs table.

        Args:
            data: Job data dict with fields matching the jobs table schema.

        Returns:
            The inserted record.

        Raises:
            Exception: If the insert fails.
        """
        client = self.get_client()
        response = client.table("jobs").insert(data).execute()
        if response.data:
            return response.data[0]
        return {}

    def check_url_hash_exists(self, url_hash: str) -> bool:
        """
        Check if a job with the given URL hash already exists.

        Args:
            url_hash: SHA256 hash of the normalized URL.

        Returns:
            True if a record with this url_hash exists.
        """
        client = self.get_client()
        response = (
            client.table("jobs")
            .select("id")
            .eq("url_hash", url_hash)
            .limit(1)
            .execute()
        )
        return bool(response.data)

    # ------------------------------------------------------------------
    # Resumes
    # ------------------------------------------------------------------

    def get_active_resume(self) -> dict[str, Any] | None:
        """
        Get the currently active resume with parsed data.

        Returns:
            Resume record dict or None if no active resume exists.
        """
        client = self.get_client()
        response = (
            client.table("resumes")
            .select("*")
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if response.data:
            return response.data[0]
        return None

    # ------------------------------------------------------------------
    # Search Profiles
    # ------------------------------------------------------------------

    def get_search_profiles(self) -> list[dict[str, Any]]:
        """
        Get all active search profiles.

        Returns:
            List of search profile records.
        """
        client = self.get_client()
        response = (
            client.table("search_profiles")
            .select("*")
            .eq("is_active", True)
            .execute()
        )
        return response.data or []

    # ------------------------------------------------------------------
    # Job Sources
    # ------------------------------------------------------------------

    def get_job_sources(self) -> list[dict[str, Any]]:
        """
        Get all job sources (active and inactive).

        Returns:
            List of job source records.
        """
        client = self.get_client()
        response = (
            client.table("job_sources")
            .select("*")
            .execute()
        )
        return response.data or []

    def get_active_job_sources(self) -> list[dict[str, Any]]:
        """
        Get only active job sources.

        Returns:
            List of active job source records.
        """
        client = self.get_client()
        response = (
            client.table("job_sources")
            .select("*")
            .eq("enabled", True)
            .execute()
        )
        return response.data or []

    # ------------------------------------------------------------------
    # Crawl Runs
    # ------------------------------------------------------------------

    def create_crawl_run(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Create a new crawl run record.

        Args:
            data: Crawl run data (started_at, status, etc.)

        Returns:
            The created record.
        """
        client = self.get_client()
        response = client.table("crawl_runs").insert(data).execute()
        if response.data:
            return response.data[0]
        return {}

    def update_crawl_run(
        self,
        crawl_run_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Update an existing crawl run record.

        Args:
            crawl_run_id: The ID of the crawl run to update.
            data: Fields to update.

        Returns:
            The updated record.
        """
        client = self.get_client()
        response = (
            client.table("crawl_runs")
            .update(data)
            .eq("id", crawl_run_id)
            .execute()
        )
        if response.data:
            return response.data[0]
        return {}

    # ------------------------------------------------------------------
    # Auto-Apply Queue
    # ------------------------------------------------------------------

    def insert_auto_apply(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Insert a record into the auto_apply_queue.

        Args:
            data: Auto-apply data (job_url, cover_letter_draft, status, etc.)

        Returns:
            The inserted record.
        """
        client = self.get_client()
        response = client.table("auto_apply_queue").insert(data).execute()
        if response.data:
            return response.data[0]
        return {}

    def get_approved_auto_applies(self) -> list[dict[str, Any]]:
        """
        Get all auto-apply items with 'approved' status, joined with job details.

        Returns:
            List of approved auto-apply records with job url, title, company.
        """
        client = self.get_client()
        response = (
            client.table("auto_apply_queue")
            .select("*, jobs(url, title, company)")
            .eq("status", "approved")
            .order("created_at", desc=True)
            .execute()
        )
        # Flatten the join: move jobs.url/title/company to top level
        results = []
        for row in (response.data or []):
            job = row.pop("jobs", None) or {}
            row["job_url"] = job.get("url", "")
            row["job_title"] = job.get("title", "")
            row["company"] = job.get("company", "")
            results.append(row)
        return results

    def update_auto_apply_status(
        self,
        item_id: str,
        status: str,
        notes: str = "",
        applied_at: str | None = None,
    ) -> dict[str, Any]:
        """
        Update the status of an auto-apply queue item.

        Args:
            item_id: The ID of the queue item.
            status: New status (e.g., 'submitted', 'failed', 'skipped').
            notes: Optional notes about the status change.
            applied_at: ISO timestamp of when the application was submitted.

        Returns:
            The updated record.
        """
        client = self.get_client()
        update_data: dict[str, Any] = {"status": status}
        if notes:
            update_data["error_message"] = notes
        if applied_at:
            update_data["submitted_at"] = applied_at

        response = (
            client.table("auto_apply_queue")
            .update(update_data)
            .eq("id", item_id)
            .execute()
        )
        if response.data:
            return response.data[0]
        return {}

    def get_recent_applications(self, days: int = 7) -> list[dict[str, Any]]:
        """
        Get recent auto-apply records for guardrail checks, with job details.

        Args:
            days: Number of days to look back.

        Returns:
            List of recent auto-apply records with 'submitted' status.
        """
        client = self.get_client()
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
        response = (
            client.table("auto_apply_queue")
            .select("*, jobs(company)")
            .eq("status", "submitted")
            .gte("submitted_at", cutoff)
            .execute()
        )
        # Flatten the join
        results = []
        for row in (response.data or []):
            job = row.pop("jobs", None) or {}
            row["company"] = job.get("company", "")
            results.append(row)
        return results
