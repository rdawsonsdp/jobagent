"""Tests for the email classifier."""

from unittest.mock import MagicMock, patch

from email_agent.classifier import EmailClassifier

MOCK_CATEGORIES = [
    {"name": "ordering", "display_name": "Ordering", "description": "How to place orders"},
    {"name": "pricing", "display_name": "Pricing", "description": "Price inquiries"},
    {"name": "availability", "display_name": "Availability", "description": "Product availability"},
    {"name": "custom_cake", "display_name": "Custom Cakes", "description": "Custom orders"},
    {"name": "complaint", "display_name": "Complaints", "description": "Quality issues"},
    {"name": "general_inquiry", "display_name": "General", "description": "Everything else"},
]


def make_mock_response(text: str) -> MagicMock:
    content_block = MagicMock()
    content_block.text = text
    response = MagicMock()
    response.content = [content_block]
    return response


def test_classify_ordering_email():
    client = MagicMock()
    client.messages.create.return_value = make_mock_response(
        '{"category": "ordering", "subcategory": "cake_order", "confidence": 0.95, "intent": "Customer wants to order a birthday cake", "key_details": {"product": "birthday cake"}}'
    )

    classifier = EmailClassifier(client, MOCK_CATEGORIES)
    result = classifier.classify("Hi, I'd like to order a birthday cake for my daughter. How do I place an order?")

    assert result["category"] == "ordering"
    assert result["confidence"] == 0.95
    assert "birthday cake" in result["intent"].lower() or "birthday cake" in str(result["key_details"])


def test_classify_empty_email():
    client = MagicMock()
    classifier = EmailClassifier(client, MOCK_CATEGORIES)
    result = classifier.classify("")

    assert result["category"] == "general_inquiry"
    assert result["confidence"] == 0.0


def test_classify_invalid_category_gets_corrected():
    client = MagicMock()
    client.messages.create.return_value = make_mock_response(
        '{"category": "nonexistent_category", "subcategory": null, "confidence": 0.8, "intent": "test", "key_details": {}}'
    )

    classifier = EmailClassifier(client, MOCK_CATEGORIES)
    result = classifier.classify("Some email text")

    assert result["category"] == "general_inquiry"
    assert result["confidence"] <= 0.5


def test_classify_handles_json_error():
    client = MagicMock()
    client.messages.create.return_value = make_mock_response("This is not JSON")

    classifier = EmailClassifier(client, MOCK_CATEGORIES)
    result = classifier.classify("Some email text")

    assert result["category"] == "general_inquiry"
    assert result["confidence"] == 0.0


def test_classify_batch():
    client = MagicMock()
    client.messages.create.return_value = make_mock_response(
        '{"category": "pricing", "subcategory": null, "confidence": 0.88, "intent": "Price inquiry", "key_details": {}}'
    )

    classifier = EmailClassifier(client, MOCK_CATEGORIES)
    emails = [
        {"id": "1", "body_text": "How much is a cake?", "subject": "Pricing"},
        {"id": "2", "body_text": "What are your rates?", "subject": "Rates"},
    ]

    results = classifier.classify_batch(emails)
    assert len(results) == 2
    assert all(r["category"] == "pricing" for r in results)
    assert results[0]["email_id"] == "1"
    assert results[1]["email_id"] == "2"
