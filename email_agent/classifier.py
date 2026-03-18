"""
Email classification engine using Claude AI.

Classifies incoming bakery emails into categories with confidence scores,
using few-shot examples from historical data.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from anthropic import Anthropic

from email_agent.config import MAX_TOKENS, MODEL

logger = logging.getLogger(__name__)


class EmailClassifier:
    """Classifies bakery emails into categories using Claude."""

    def __init__(self, client: Anthropic, categories: list[dict] | None = None) -> None:
        self.client = client
        self._categories = categories or []

    def set_categories(self, categories: list[dict]) -> None:
        """Update the available categories (loaded from DB)."""
        self._categories = categories

    def classify(self, email_text: str, subject: str = "") -> dict[str, Any]:
        """
        Classify an email into a category.

        Returns:
            {
                "category": "ordering",
                "subcategory": "cake_order",
                "confidence": 0.94,
                "intent": "Customer wants to know how to place a cake order",
                "key_details": {"product": "birthday cake", "date": "March 25"}
            }
        """
        if not email_text.strip():
            return {
                "category": "general_inquiry",
                "subcategory": None,
                "confidence": 0.0,
                "intent": "Empty email",
                "key_details": {},
            }

        category_descriptions = "\n".join(
            f"- {c['name']}: {c.get('description', c.get('display_name', ''))}"
            for c in self._categories
        )

        system_prompt = f"""You are an email classifier for a bakery. Your job is to categorize
incoming customer emails into exactly one of the following categories:

{category_descriptions}

Analyze the email and return a JSON object with:
- category: the category name (must be one from the list above)
- subcategory: a more specific label if applicable (e.g., "wedding_cake", "birthday_order")
- confidence: your confidence score from 0.0 to 1.0
- intent: a brief one-sentence summary of what the customer wants
- key_details: extracted details like product names, dates, quantities, etc.

Return ONLY valid JSON, no other text."""

        user_prompt = f"Subject: {subject}\n\n{email_text}" if subject else email_text

        try:
            response = self.client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                temperature=0.1,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )

            text = response.content[0].text.strip()
            # Handle markdown code blocks
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            result = json.loads(text)

            # Validate category is in our list
            valid_names = {c["name"] for c in self._categories}
            if result.get("category") not in valid_names:
                result["category"] = "general_inquiry"
                result["confidence"] = min(result.get("confidence", 0.5), 0.5)

            return result

        except json.JSONDecodeError:
            logger.error("Failed to parse classifier response as JSON")
            return {
                "category": "general_inquiry",
                "subcategory": None,
                "confidence": 0.0,
                "intent": "Classification failed",
                "key_details": {},
            }
        except Exception:
            logger.exception("Email classification failed")
            return {
                "category": "general_inquiry",
                "subcategory": None,
                "confidence": 0.0,
                "intent": "Classification error",
                "key_details": {},
            }

    def classify_batch(self, emails: list[dict]) -> list[dict]:
        """Classify multiple emails. Returns list of classification results."""
        results = []
        for email in emails:
            result = self.classify(
                email.get("body_text", ""),
                email.get("subject", ""),
            )
            result["email_id"] = email.get("id")
            results.append(result)
        return results
