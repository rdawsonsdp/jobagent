"""
Resume parser using Claude AI.

Extracts structured information from raw resume text including:
skills, target titles, experience, certifications, education,
work history, and preferred keywords.
"""

from __future__ import annotations

import logging
from typing import Any

from jobcrawler.ai.claude_client import ClaudeClient

logger = logging.getLogger(__name__)

# Expected keys in parsed resume output
EXPECTED_KEYS = [
    "skills",
    "target_titles",
    "years_of_experience",
    "certifications",
    "preferred_keywords",
    "summary",
    "education",
    "work_history",
]


def parse_resume(
    text: str,
    client: ClaudeClient | None = None,
) -> dict[str, Any]:
    """
    Parse raw resume text into structured JSON using Claude.

    Args:
        text: Raw resume text content (plain text or extracted from PDF/DOCX).
        client: Optional ClaudeClient instance. Creates one if not provided.

    Returns:
        Dict with structured resume data:
            - skills: list[str] - Technical and soft skills
            - target_titles: list[str] - Suitable job titles
            - years_of_experience: int - Total professional years
            - certifications: list[str] - Professional certifications
            - preferred_keywords: list[str] - Strength keywords for matching
            - summary: str - 2-3 sentence professional summary
            - education: list[dict] - Education history with institution, degree, field, year
            - work_history: list[dict] - Work history with company, title, dates, highlights
    """
    if not text or not text.strip():
        logger.warning("Empty resume text provided for parsing")
        return _empty_result("Empty resume text")

    if client is None:
        client = ClaudeClient()

    try:
        parsed = client.parse_resume(text)
    except Exception as e:
        logger.error("Failed to parse resume: %s", e)
        return _empty_result(str(e))

    # Validate and normalize the result
    validated = _validate_parsed_resume(parsed)

    logger.info(
        "Resume parsed: %d skills, %d target titles, %d years experience",
        len(validated.get("skills", [])),
        len(validated.get("target_titles", [])),
        validated.get("years_of_experience", 0),
    )

    return validated


def _validate_parsed_resume(parsed: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize parsed resume data, ensuring all expected keys exist."""
    result: dict[str, Any] = {}

    # Skills: ensure list of strings
    skills = parsed.get("skills", [])
    result["skills"] = [str(s).strip() for s in skills if s] if isinstance(skills, list) else []

    # Target titles: ensure list of strings
    titles = parsed.get("target_titles", [])
    result["target_titles"] = [str(t).strip() for t in titles if t] if isinstance(titles, list) else []

    # Years of experience: ensure numeric
    years = parsed.get("years_of_experience", 0)
    try:
        result["years_of_experience"] = int(float(years))
    except (ValueError, TypeError):
        result["years_of_experience"] = 0

    # Certifications: ensure list of strings
    certs = parsed.get("certifications", [])
    result["certifications"] = [str(c).strip() for c in certs if c] if isinstance(certs, list) else []

    # Preferred keywords: ensure list of strings
    keywords = parsed.get("preferred_keywords", [])
    result["preferred_keywords"] = (
        [str(k).strip() for k in keywords if k] if isinstance(keywords, list) else []
    )

    # Summary: ensure string
    result["summary"] = str(parsed.get("summary", "")).strip()

    # Education: ensure list of dicts
    education = parsed.get("education", [])
    if isinstance(education, list):
        result["education"] = [
            {
                "institution": str(e.get("institution", "")).strip(),
                "degree": str(e.get("degree", "")).strip(),
                "field": str(e.get("field", "")).strip(),
                "year": str(e.get("year", "")).strip(),
            }
            for e in education
            if isinstance(e, dict)
        ]
    else:
        result["education"] = []

    # Work history: ensure list of dicts
    work = parsed.get("work_history", [])
    if isinstance(work, list):
        result["work_history"] = [
            {
                "company": str(w.get("company", "")).strip(),
                "title": str(w.get("title", "")).strip(),
                "start_date": str(w.get("start_date", "")).strip(),
                "end_date": str(w.get("end_date", "")).strip(),
                "highlights": (
                    [str(h).strip() for h in w.get("highlights", []) if h]
                    if isinstance(w.get("highlights"), list)
                    else []
                ),
            }
            for w in work
            if isinstance(w, dict)
        ]
    else:
        result["work_history"] = []

    return result


def _empty_result(error: str = "") -> dict[str, Any]:
    """Return an empty parsed resume structure."""
    result: dict[str, Any] = {
        "skills": [],
        "target_titles": [],
        "years_of_experience": 0,
        "certifications": [],
        "preferred_keywords": [],
        "summary": "",
        "education": [],
        "work_history": [],
    }
    if error:
        result["parse_error"] = error
    return result
