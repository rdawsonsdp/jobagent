"""
Cover letter generation using Claude AI.

Generates tailored cover letters that are:
  - 3 paragraphs
  - Under 300 words
  - Specific to the job + candidate match
"""

from __future__ import annotations

import logging
from typing import Any

from jobcrawler.ai.claude_client import ClaudeClient

logger = logging.getLogger(__name__)


def generate_cover_letter(
    client: ClaudeClient,
    job: dict[str, Any],
    resume_data: dict[str, Any],
) -> str:
    """
    Generate a tailored cover letter for a specific job application.

    Args:
        client: ClaudeClient instance for API calls.
        job: Job data dict with at minimum:
            - title: str
            - company: str
            - description: str
            Optional:
            - location: str
            - keywords_matched: list[str]
        resume_data: Parsed resume data dict with:
            - skills: list[str]
            - summary: str
            - years_of_experience: int
            - work_history: list[dict]

    Returns:
        Cover letter text (3 paragraphs, under 300 words).
        Returns empty string on failure.
    """
    if not job or not resume_data:
        logger.warning("Missing job or resume data for cover letter generation")
        return ""

    try:
        cover_letter = client.generate_cover_letter(job, resume_data)
        validated = _validate_cover_letter(cover_letter)
        return validated
    except Exception as e:
        logger.error(
            "Failed to generate cover letter for '%s' at '%s': %s",
            job.get("title", "N/A"),
            job.get("company", "N/A"),
            e,
        )
        return ""


def _validate_cover_letter(text: str) -> str:
    """
    Validate and clean up the generated cover letter.

    Ensures it meets the requirements:
    - Non-empty
    - Reasonable length (under ~400 words to allow some flexibility)
    - Strip any accidental metadata or formatting artifacts
    """
    if not text or not text.strip():
        return ""

    text = text.strip()

    # Remove any "Dear Hiring Manager" or salutation lines the model might add
    lines = text.split("\n")
    cleaned_lines: list[str] = []
    skip_patterns = [
        "dear ",
        "to whom",
        "hiring manager",
        "sincerely",
        "best regards",
        "yours truly",
        "respectfully",
        "thank you for your consideration",
    ]

    for line in lines:
        lower_line = line.strip().lower()
        # Skip greeting/sign-off lines
        if any(lower_line.startswith(p) or lower_line == p.rstrip() for p in skip_patterns):
            continue
        # Skip lines that are just a name (single word, capitalized, < 30 chars)
        if (
            len(line.strip()) < 30
            and line.strip().istitle()
            and " " not in line.strip().rstrip(",")
        ):
            continue
        cleaned_lines.append(line)

    text = "\n".join(cleaned_lines).strip()

    # Check word count
    word_count = len(text.split())
    if word_count > 400:
        logger.warning(
            "Cover letter exceeds 400 words (%d words). Truncating.",
            word_count,
        )
        # Truncate to approximately 300 words at a paragraph boundary
        paragraphs = text.split("\n\n")
        truncated: list[str] = []
        current_words = 0
        for para in paragraphs:
            para_words = len(para.split())
            if current_words + para_words <= 320:
                truncated.append(para)
                current_words += para_words
            else:
                break
        if truncated:
            text = "\n\n".join(truncated)

    if not text:
        return ""

    return text
