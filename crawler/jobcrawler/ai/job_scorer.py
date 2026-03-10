"""
Job scoring module using Claude AI.

Builds a scoring prompt that includes the candidate's resume data
(skills, target titles, experience) and the job description,
then returns a relevance score 0-10 with detailed reasoning.
"""

from __future__ import annotations

import logging
from typing import Any

from jobcrawler.ai.claude_client import ClaudeClient

logger = logging.getLogger(__name__)


def score_jobs(
    jobs: list[dict[str, Any]],
    resume_data: dict[str, Any],
    client: ClaudeClient | None = None,
) -> list[dict[str, Any]]:
    """
    Score a list of jobs against the candidate's resume.

    Args:
        jobs: List of job dicts. Each should contain at minimum:
            - title: str
            - company: str
            - description: str (plain text, truncated to ~3000 chars)
            Optional:
            - location: str
            - is_remote: bool
            - salary_text: str
            - keywords: list[str]
        resume_data: Parsed resume dict with:
            - skills: list[str]
            - target_titles: list[str]
            - years_of_experience: int
            - certifications: list[str]
            - preferred_keywords: list[str]
            - summary: str
        client: Optional ClaudeClient instance. Creates one if not provided.

    Returns:
        List of score dicts (same length as jobs), each containing:
            - score: float (0-10)
            - reasoning: str (1-2 sentences)
            - keywords_matched: list[str] (resume skills found in job)
            - keywords_missing: list[str] (job requirements candidate lacks)
    """
    if not jobs:
        return []

    if not resume_data:
        logger.warning("No resume data provided for scoring")
        return [_default_score("No resume data available") for _ in jobs]

    if client is None:
        client = ClaudeClient()

    try:
        scores = client.score_jobs(jobs, resume_data)
        return _validate_scores(scores, len(jobs))
    except Exception as e:
        logger.error("Failed to score jobs: %s", e)
        return [_default_score(f"Scoring error: {str(e)}") for _ in jobs]


def score_single_job(
    job: dict[str, Any],
    resume_data: dict[str, Any],
    client: ClaudeClient | None = None,
) -> dict[str, Any]:
    """
    Score a single job against the candidate's resume.

    Convenience wrapper around score_jobs for single-job scoring.

    Args:
        job: Job data dict.
        resume_data: Parsed resume data dict.
        client: Optional ClaudeClient instance.

    Returns:
        Score dict with score, reasoning, keywords_matched, keywords_missing.
    """
    results = score_jobs([job], resume_data, client=client)
    return results[0] if results else _default_score("No result returned")


def _validate_scores(
    scores: list[dict[str, Any]],
    expected_count: int,
) -> list[dict[str, Any]]:
    """Validate and normalize score results."""
    validated: list[dict[str, Any]] = []

    for i in range(expected_count):
        if i < len(scores):
            raw = scores[i]
            validated.append({
                "score": _clamp_score(raw.get("score", 0.0)),
                "reasoning": str(raw.get("reasoning", "")).strip(),
                "keywords_matched": _ensure_string_list(raw.get("keywords_matched", [])),
                "keywords_missing": _ensure_string_list(raw.get("keywords_missing", [])),
            })
        else:
            validated.append(_default_score("No score returned for this job"))

    return validated


def _clamp_score(value: Any) -> float:
    """Ensure score is a float between 0.0 and 10.0."""
    try:
        score = float(value)
        return max(0.0, min(10.0, score))
    except (ValueError, TypeError):
        return 0.0


def _ensure_string_list(value: Any) -> list[str]:
    """Ensure value is a list of strings."""
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if item]


def _default_score(reason: str = "") -> dict[str, Any]:
    """Return a default score dict."""
    return {
        "score": 0.0,
        "reasoning": reason or "Score unavailable",
        "keywords_matched": [],
        "keywords_missing": [],
    }
