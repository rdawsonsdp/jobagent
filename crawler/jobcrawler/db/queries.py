"""
SQL query constants and helper functions for common database operations.

These are used by the Supabase client and crawl orchestrator for
operations that benefit from raw SQL or RPC calls.
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# Jobs table queries
# ---------------------------------------------------------------------------

CHECK_URL_HASH_EXISTS = """
SELECT EXISTS(
    SELECT 1 FROM jobs WHERE url_hash = :url_hash
) AS exists;
"""

GET_JOBS_BY_SCORE = """
SELECT id, title, company, url, relevance_score, score_reasoning,
       posted_date, is_remote, salary_text, keywords_matched
FROM jobs
WHERE relevance_score >= :min_score
ORDER BY relevance_score DESC, posted_date DESC
LIMIT :limit;
"""

GET_RECENT_JOBS = """
SELECT id, title, company, url, relevance_score, posted_date,
       source_id, is_remote, salary_text
FROM jobs
WHERE created_at >= NOW() - INTERVAL ':days days'
ORDER BY created_at DESC
LIMIT :limit;
"""

COUNT_JOBS_BY_SOURCE = """
SELECT
    js.name AS source_name,
    COUNT(j.id) AS job_count,
    AVG(j.relevance_score) AS avg_score
FROM jobs j
JOIN job_sources js ON j.source_id = js.id
WHERE j.created_at >= NOW() - INTERVAL ':days days'
GROUP BY js.name
ORDER BY job_count DESC;
"""


# ---------------------------------------------------------------------------
# Crawl runs queries
# ---------------------------------------------------------------------------

GET_LATEST_CRAWL_RUN = """
SELECT id, started_at, finished_at, status,
       total_jobs_found, new_jobs_added, duplicates_skipped, errors
FROM crawl_runs
ORDER BY started_at DESC
LIMIT 1;
"""

GET_CRAWL_STATS = """
SELECT
    DATE(started_at) AS crawl_date,
    COUNT(*) AS runs,
    SUM(total_jobs_found) AS total_found,
    SUM(new_jobs_added) AS total_new,
    SUM(errors) AS total_errors,
    AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_duration_seconds
FROM crawl_runs
WHERE started_at >= NOW() - INTERVAL ':days days'
AND status = 'completed'
GROUP BY DATE(started_at)
ORDER BY crawl_date DESC;
"""


# ---------------------------------------------------------------------------
# Auto-apply queries
# ---------------------------------------------------------------------------

GET_DAILY_APPLICATION_COUNT = """
SELECT COUNT(*) AS count
FROM auto_apply_queue
WHERE status = 'submitted'
AND submitted_at >= DATE_TRUNC('day', NOW());
"""

GET_WEEKLY_COMPANY_COUNTS = """
SELECT aaq.job_id, j.company, COUNT(*) AS count
FROM auto_apply_queue aaq
JOIN jobs j ON aaq.job_id = j.id
WHERE aaq.status = 'submitted'
AND aaq.submitted_at >= NOW() - INTERVAL '7 days'
GROUP BY aaq.job_id, j.company;
"""

GET_AUTO_APPLY_STATS = """
SELECT
    status,
    COUNT(*) AS count
FROM auto_apply_queue
GROUP BY status
ORDER BY count DESC;
"""


# ---------------------------------------------------------------------------
# Search profiles queries
# ---------------------------------------------------------------------------

GET_ACTIVE_SEARCH_PROFILES_WITH_SOURCES = """
SELECT
    sp.*,
    ARRAY_AGG(js.name) AS source_names
FROM search_profiles sp
LEFT JOIN job_sources js ON js.enabled = true
WHERE sp.is_active = true
GROUP BY sp.id
ORDER BY sp.name;
"""


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def build_job_insert(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """
    Build an INSERT query for the jobs table from a data dict.

    Args:
        data: Dict of column name -> value pairs.

    Returns:
        Tuple of (query_string, params_dict).
    """
    columns = list(data.keys())
    placeholders = [f":{col}" for col in columns]

    query = (
        f"INSERT INTO jobs ({', '.join(columns)}) "
        f"VALUES ({', '.join(placeholders)}) "
        f"ON CONFLICT (url_hash) DO NOTHING "
        f"RETURNING id;"
    )

    return query, data


def build_crawl_summary_update(
    crawl_run_id: str,
    total_jobs_found: int = 0,
    new_jobs_added: int = 0,
    duplicates_skipped: int = 0,
    errors: int = 0,
    status: str = "completed",
) -> dict[str, Any]:
    """
    Build an update dict for completing a crawl run.

    Args:
        crawl_run_id: The crawl run ID to update.
        total_jobs_found: Total jobs discovered.
        new_jobs_added: New jobs inserted (after dedup).
        duplicates_skipped: Jobs skipped as duplicates.
        errors: Number of errors encountered.
        status: Final status (completed, failed, cancelled).

    Returns:
        Dict suitable for passing to SupabaseDB.update_crawl_run().
    """
    from datetime import datetime

    return {
        "finished_at": datetime.utcnow().isoformat(),
        "status": status,
        "total_jobs_found": total_jobs_found,
        "new_jobs_added": new_jobs_added,
        "duplicates_skipped": duplicates_skipped,
        "errors": errors,
    }
