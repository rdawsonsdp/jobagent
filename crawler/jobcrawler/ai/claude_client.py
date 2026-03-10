"""
Wrapper around the Anthropic Python SDK for Claude API interactions.

Provides methods for:
  - Scoring jobs against a resume
  - Parsing resume text into structured data
  - Generating cover letters
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "crawler", ".env"))

MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096


class ClaudeClient:
    """
    Wrapper around the Anthropic SDK for job search AI tasks.

    All methods handle errors gracefully and log failures without
    crashing the pipeline.
    """

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        if not self.api_key:
            logger.warning("ANTHROPIC_API_KEY not set. Claude API calls will fail.")
        self.client = Anthropic(api_key=self.api_key) if self.api_key else None

    def _call_api(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = MAX_TOKENS,
        temperature: float = 0.3,
    ) -> str:
        """Make a single API call to Claude and return the text response."""
        if not self.client:
            raise RuntimeError("Anthropic client not initialized (missing API key)")

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        # Extract text from response
        text_parts = []
        for block in response.content:
            if hasattr(block, "text"):
                text_parts.append(block.text)

        return "\n".join(text_parts)

    def score_jobs(
        self,
        jobs: list[dict[str, Any]],
        resume_data: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Score a batch of jobs against the candidate's resume data.

        Args:
            jobs: List of job dicts with title, company, description, etc.
            resume_data: Parsed resume data with skills, experience, etc.

        Returns:
            List of score dicts, one per job, each containing:
                - score: float (0-10)
                - reasoning: str
                - keywords_matched: list[str]
                - keywords_missing: list[str]
        """
        if not jobs:
            return []

        system_prompt = (
            "You are a job relevance scoring expert. You evaluate how well "
            "job listings match a candidate's profile. You return ONLY valid JSON."
        )

        # Build the resume summary for the prompt
        skills = resume_data.get("skills", [])
        target_titles = resume_data.get("target_titles", [])
        years_exp = resume_data.get("years_of_experience", 0)
        certifications = resume_data.get("certifications", [])
        preferred_keywords = resume_data.get("preferred_keywords", [])
        summary = resume_data.get("summary", "")

        resume_section = (
            f"CANDIDATE PROFILE:\n"
            f"- Summary: {summary}\n"
            f"- Target titles: {', '.join(target_titles)}\n"
            f"- Years of experience: {years_exp}\n"
            f"- Skills: {', '.join(skills)}\n"
            f"- Certifications: {', '.join(certifications)}\n"
            f"- Preferred keywords: {', '.join(preferred_keywords)}\n"
        )

        jobs_section = "JOBS TO SCORE:\n\n"
        for i, job in enumerate(jobs):
            jobs_section += (
                f"--- Job {i + 1} ---\n"
                f"Title: {job.get('title', 'N/A')}\n"
                f"Company: {job.get('company', 'N/A')}\n"
                f"Location: {job.get('location', 'N/A')}\n"
                f"Remote: {job.get('is_remote', False)}\n"
                f"Salary: {job.get('salary_text', 'N/A')}\n"
                f"Description (truncated):\n{job.get('description', '')[:2000]}\n\n"
            )

        user_prompt = (
            f"{resume_section}\n\n"
            f"{jobs_section}\n\n"
            f"Score each job 0-10 based on relevance to the candidate's profile.\n"
            f"Consider: title match, skills overlap, experience level, location/remote preferences.\n\n"
            f"Return a JSON array with exactly {len(jobs)} objects, each with:\n"
            f"- \"score\": number 0-10 (decimal allowed)\n"
            f"- \"reasoning\": brief explanation (1-2 sentences)\n"
            f"- \"keywords_matched\": list of candidate skills/keywords found in the job\n"
            f"- \"keywords_missing\": list of important job requirements the candidate lacks\n\n"
            f"Return ONLY the JSON array, no other text."
        )

        try:
            response_text = self._call_api(system_prompt, user_prompt)
            scores = self._parse_json_array(response_text, expected_length=len(jobs))
            return scores
        except Exception as e:
            logger.error("Error scoring jobs via Claude: %s", e)
            return [
                {
                    "score": 0.0,
                    "reasoning": f"Scoring error: {str(e)}",
                    "keywords_matched": [],
                    "keywords_missing": [],
                }
                for _ in jobs
            ]

    def parse_resume(self, text: str) -> dict[str, Any]:
        """
        Parse resume text into structured JSON.

        Args:
            text: Raw resume text content.

        Returns:
            Dict with keys: skills, target_titles, years_of_experience,
            certifications, preferred_keywords, summary, education, work_history.
        """
        system_prompt = (
            "You are a resume parsing expert. Extract structured information "
            "from resume text. Return ONLY valid JSON."
        )

        user_prompt = (
            f"Parse the following resume into structured JSON:\n\n"
            f"---\n{text}\n---\n\n"
            f"Return a JSON object with these keys:\n"
            f"- \"skills\": list of technical and soft skills\n"
            f"- \"target_titles\": list of job titles the candidate would be suited for\n"
            f"- \"years_of_experience\": estimated total years of professional experience (number)\n"
            f"- \"certifications\": list of certifications\n"
            f"- \"preferred_keywords\": list of keywords that represent the candidate's strengths\n"
            f"- \"summary\": 2-3 sentence professional summary\n"
            f"- \"education\": list of objects with \"institution\", \"degree\", \"field\", \"year\"\n"
            f"- \"work_history\": list of objects with \"company\", \"title\", \"start_date\", \"end_date\", \"highlights\" (list of strings)\n\n"
            f"Return ONLY the JSON object, no other text."
        )

        try:
            response_text = self._call_api(system_prompt, user_prompt)
            parsed = self._parse_json_object(response_text)
            return parsed
        except Exception as e:
            logger.error("Error parsing resume via Claude: %s", e)
            return {
                "skills": [],
                "target_titles": [],
                "years_of_experience": 0,
                "certifications": [],
                "preferred_keywords": [],
                "summary": "",
                "education": [],
                "work_history": [],
                "parse_error": str(e),
            }

    def generate_cover_letter(
        self,
        job: dict[str, Any],
        resume: dict[str, Any],
    ) -> str:
        """
        Generate a tailored cover letter for a specific job.

        Args:
            job: Job data dict with title, company, description, etc.
            resume: Parsed resume data.

        Returns:
            Cover letter text (3 paragraphs, under 300 words).
        """
        system_prompt = (
            "You are an expert career coach who writes compelling, "
            "personalized cover letters. Write naturally and specifically -- "
            "avoid generic phrases. Keep the letter under 300 words and "
            "exactly 3 paragraphs."
        )

        skills = resume.get("skills", [])
        summary = resume.get("summary", "")
        experience = resume.get("years_of_experience", 0)
        work_history = resume.get("work_history", [])

        # Get most recent role for context
        recent_role = ""
        if work_history:
            latest = work_history[0]
            recent_role = f"{latest.get('title', '')} at {latest.get('company', '')}"

        keywords_matched = job.get("keywords_matched", [])

        user_prompt = (
            f"Write a cover letter for this job application:\n\n"
            f"JOB:\n"
            f"- Title: {job.get('title', 'N/A')}\n"
            f"- Company: {job.get('company', 'N/A')}\n"
            f"- Description: {job.get('description', '')[:2000]}\n\n"
            f"CANDIDATE:\n"
            f"- Summary: {summary}\n"
            f"- Most recent role: {recent_role}\n"
            f"- Years of experience: {experience}\n"
            f"- Key skills: {', '.join(skills[:15])}\n"
            f"- Matching keywords: {', '.join(keywords_matched)}\n\n"
            f"Requirements:\n"
            f"- Exactly 3 paragraphs\n"
            f"- Under 300 words total\n"
            f"- Reference specific skills that match the job\n"
            f"- Show enthusiasm for the company specifically\n"
            f"- Professional but warm tone\n"
            f"- Do NOT include greeting/salutation or sign-off lines\n"
            f"- Return ONLY the 3 paragraphs of body text"
        )

        try:
            return self._call_api(
                system_prompt,
                user_prompt,
                max_tokens=1024,
                temperature=0.7,
            )
        except Exception as e:
            logger.error("Error generating cover letter via Claude: %s", e)
            return ""

    @staticmethod
    def _parse_json_array(
        text: str,
        expected_length: int,
    ) -> list[dict[str, Any]]:
        """Extract a JSON array from Claude's response text."""
        # Try to find JSON array in the response
        text = text.strip()

        # Remove markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(
                line for line in lines
                if not line.strip().startswith("```")
            )

        # Find the array
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1:
            raise ValueError("No JSON array found in response")

        json_str = text[start:end + 1]
        parsed = json.loads(json_str)

        if not isinstance(parsed, list):
            raise ValueError("Parsed JSON is not a list")

        # Pad or truncate to expected length
        while len(parsed) < expected_length:
            parsed.append({
                "score": 0.0,
                "reasoning": "No score returned",
                "keywords_matched": [],
                "keywords_missing": [],
            })

        return parsed[:expected_length]

    @staticmethod
    def _parse_json_object(text: str) -> dict[str, Any]:
        """Extract a JSON object from Claude's response text."""
        text = text.strip()

        # Remove markdown code fences
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(
                line for line in lines
                if not line.strip().startswith("```")
            )

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON object found in response")

        json_str = text[start:end + 1]
        parsed = json.loads(json_str)

        if not isinstance(parsed, dict):
            raise ValueError("Parsed JSON is not a dict")

        return parsed
