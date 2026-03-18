"""Tests for the response engine."""

from unittest.mock import MagicMock

from email_agent.config import BakeryConfig
from email_agent.response_engine import ResponseEngine


def make_mock_response(text: str) -> MagicMock:
    content_block = MagicMock()
    content_block.text = text
    response = MagicMock()
    response.content = [content_block]
    return response


def test_should_escalate_with_keyword():
    client = MagicMock()
    supabase = MagicMock()
    config = BakeryConfig()
    config._cache = {
        "escalation_keywords": ["lawyer", "health department", "allergic reaction"],
        "contact": {"email": "bakery@test.com"},
    }

    engine = ResponseEngine(client, supabase, config)

    email = {"body_text": "I had an allergic reaction to your cake!", "subject": "Urgent"}
    classification = {"category": "complaint", "confidence": 0.9}

    result = engine.generate_response(email, classification)
    assert result["action"] == "escalate"
    assert result["confidence"] == 0.0


def test_should_escalate_lawyer_mention():
    client = MagicMock()
    supabase = MagicMock()
    config = BakeryConfig()
    config._cache = {
        "escalation_keywords": ["lawyer", "health department"],
        "contact": {"email": "bakery@test.com"},
    }

    engine = ResponseEngine(client, supabase, config)

    email = {"body_text": "My lawyer will be contacting you", "subject": "Legal"}
    classification = {"category": "complaint", "confidence": 0.9}

    result = engine.generate_response(email, classification)
    assert result["action"] == "escalate"


def test_determine_action_auto_send():
    client = MagicMock()
    supabase = MagicMock()
    config = BakeryConfig()
    config._cache = {}

    engine = ResponseEngine(client, supabase, config)
    assert engine._determine_action(0.95, 0.90) == "auto_send"


def test_determine_action_needs_review():
    client = MagicMock()
    supabase = MagicMock()
    config = BakeryConfig()
    config._cache = {}

    engine = ResponseEngine(client, supabase, config)
    assert engine._determine_action(0.80, 0.90) == "needs_review"


def test_determine_action_escalate():
    client = MagicMock()
    supabase = MagicMock()
    config = BakeryConfig()
    config._cache = {}

    engine = ResponseEngine(client, supabase, config)
    assert engine._determine_action(0.50, 0.90) == "escalate"
