"""
Response generation engine using RAG + Claude.

Finds similar past email exchanges via vector search and uses them
as few-shot examples to generate contextual bakery responses.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from anthropic import Anthropic
from supabase import Client

from email_agent.config import (
    DEFAULT_AUTO_SEND_THRESHOLD,
    DEFAULT_DRAFT_THRESHOLD,
    MAX_TOKENS,
    MODEL,
    BakeryConfig,
)

logger = logging.getLogger(__name__)


class ResponseEngine:
    """Generates email responses using RAG with historical email pairs."""

    def __init__(
        self,
        client: Anthropic,
        supabase: Client,
        bakery_config: BakeryConfig,
    ) -> None:
        self.client = client
        self.db = supabase
        self.config = bakery_config

    def generate_response(
        self,
        email: dict[str, Any],
        classification: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Generate a response for an incoming email.

        Args:
            email: Parsed email record (from bakery_emails table)
            classification: Result from EmailClassifier.classify()

        Returns:
            {
                "draft_response": "...",
                "confidence": 0.91,
                "action": "auto_send" | "needs_review" | "escalate",
                "similar_examples": [uuid, ...],
                "reasoning": "..."
            }
        """
        category = classification.get("category", "general_inquiry")
        email_text = email.get("body_text", "")
        subject = email.get("subject", "")

        # Check for escalation keywords
        if self._should_escalate(email_text, subject):
            return {
                "draft_response": "",
                "confidence": 0.0,
                "action": "escalate",
                "similar_examples": [],
                "reasoning": "Email contains escalation keywords - requires human attention",
            }

        # Find similar past exchanges
        similar = self._find_similar_emails(email_text, category)

        # Build few-shot examples from similar exchanges
        examples = self._build_examples(similar)

        # Generate response with Claude
        bakery_context = self.config.get_bakery_context()
        draft, reasoning = self._generate_with_claude(
            email_text=email_text,
            subject=subject,
            category=category,
            intent=classification.get("intent", ""),
            key_details=classification.get("key_details", {}),
            examples=examples,
            bakery_context=bakery_context,
        )

        # Determine confidence and action
        classification_confidence = classification.get("confidence", 0.0)
        example_quality = min(len(similar) / 3, 1.0)  # More examples = higher confidence
        confidence = classification_confidence * 0.6 + example_quality * 0.4

        # Get category-specific threshold
        threshold = self._get_category_threshold(category)
        action = self._determine_action(confidence, threshold)

        return {
            "draft_response": draft,
            "confidence": round(confidence, 3),
            "action": action,
            "similar_examples": [s["id"] for s in similar],
            "reasoning": reasoning,
        }

    def _should_escalate(self, email_text: str, subject: str) -> bool:
        """Check if email contains keywords requiring human escalation."""
        keywords = self.config.get_escalation_keywords()
        combined = f"{subject} {email_text}".lower()
        return any(kw.lower() in combined for kw in keywords)

    def _find_similar_emails(
        self,
        email_text: str,
        category: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        """
        Find similar past email pairs using vector similarity.

        Falls back to category-based lookup if embeddings aren't available.
        """
        # Try vector search first
        try:
            embedding = self._get_embedding(email_text)
            if embedding:
                result = self.db.rpc(
                    "match_email_pairs",
                    {
                        "query_embedding": embedding,
                        "match_threshold": 0.5,
                        "match_count": limit,
                        "filter_category": category,
                    },
                ).execute()
                if result.data:
                    return result.data
        except Exception:
            logger.warning("Vector search failed, falling back to category match")

        # Fallback: fetch by category
        try:
            query = self.db.table("bakery_email_pairs").select("*")
            if category:
                query = query.eq("category", category)
            result = query.order("quality_score", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            logger.exception("Failed to find similar emails")
            return []

    def _build_examples(self, similar_pairs: list[dict]) -> list[dict[str, str]]:
        """Fetch the actual email content for similar pairs to use as few-shot examples."""
        examples = []

        for pair in similar_pairs:
            customer_id = pair.get("customer_email_id")
            response_id = pair.get("response_email_id")

            if not customer_id or not response_id:
                continue

            try:
                customer = (
                    self.db.table("bakery_emails")
                    .select("body_text, subject")
                    .eq("id", customer_id)
                    .single()
                    .execute()
                )
                response = (
                    self.db.table("bakery_emails")
                    .select("body_text")
                    .eq("id", response_id)
                    .single()
                    .execute()
                )

                if customer.data and response.data:
                    examples.append({
                        "customer_email": customer.data.get("body_text", ""),
                        "staff_response": response.data.get("body_text", ""),
                    })
            except Exception:
                continue

        return examples

    def _generate_with_claude(
        self,
        email_text: str,
        subject: str,
        category: str,
        intent: str,
        key_details: dict,
        examples: list[dict[str, str]],
        bakery_context: str,
    ) -> tuple[str, str]:
        """Generate a response using Claude with context and examples."""

        examples_text = ""
        if examples:
            examples_text = "\n\nHere are examples of how we've responded to similar emails:\n"
            for i, ex in enumerate(examples, 1):
                examples_text += f"\n--- Example {i} ---\n"
                examples_text += f"Customer: {ex['customer_email'][:500]}\n"
                examples_text += f"Our Response: {ex['staff_response'][:500]}\n"

        system_prompt = f"""You are an email assistant for a bakery. You write friendly, helpful,
and professional responses to customer emails in the bakery's voice.

BAKERY INFORMATION:
{bakery_context}

GUIDELINES:
- Be warm, friendly, and professional
- Answer the customer's specific question(s) directly
- Include relevant details from the bakery information above
- Keep responses concise but complete (2-4 short paragraphs max)
- If the customer is asking about something you don't have info on, say you'll check and get back to them
- Sign off warmly (e.g., "Warm regards," or "Happy baking!")
- Do NOT make up menu items, prices, or policies not in the bakery info
- Do NOT promise things you can't verify
{examples_text}"""

        user_prompt = f"""Please draft a response to this customer email.

Category: {category}
Customer's intent: {intent}
Key details: {json.dumps(key_details)}

Subject: {subject}
Email:
{email_text}

Respond with a JSON object containing:
- "response": the draft email response text
- "reasoning": brief explanation of why you responded this way"""

        try:
            response = self.client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                temperature=0.4,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )

            text = response.content[0].text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            parsed = json.loads(text)
            return parsed.get("response", ""), parsed.get("reasoning", "")

        except json.JSONDecodeError:
            # If JSON parsing fails, treat the whole response as the draft
            text = response.content[0].text.strip()
            return text, "Direct response (JSON parsing failed)"
        except Exception:
            logger.exception("Failed to generate response")
            return "", "Generation failed"

    def _get_embedding(self, text: str) -> list[float] | None:
        """Generate an embedding for text using Claude or a dedicated model."""
        try:
            # Use Anthropic's built-in embedding via a simple prompt trick,
            # or switch to a dedicated embedding API (e.g., Voyage AI)
            # For now, return None to use fallback category matching
            # TODO: Integrate voyage-ai or similar embedding API
            return None
        except Exception:
            return None

    def _get_category_threshold(self, category: str) -> float:
        """Get the auto-send confidence threshold for a category."""
        try:
            result = (
                self.db.table("bakery_email_categories")
                .select("confidence_threshold, auto_reply_enabled")
                .eq("name", category)
                .single()
                .execute()
            )
            if result.data:
                if not result.data.get("auto_reply_enabled", False):
                    return 999.0  # Never auto-send for disabled categories
                return result.data.get("confidence_threshold", DEFAULT_AUTO_SEND_THRESHOLD)
        except Exception:
            pass
        return DEFAULT_AUTO_SEND_THRESHOLD

    def _determine_action(self, confidence: float, threshold: float) -> str:
        """Determine the action based on confidence and threshold."""
        if confidence >= threshold:
            return "auto_send"
        elif confidence >= DEFAULT_DRAFT_THRESHOLD:
            return "needs_review"
        else:
            return "escalate"
