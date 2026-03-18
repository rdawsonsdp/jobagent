"""Tests for email parsing utilities."""

from email_agent.email_parser import (
    clean_email_body,
    extract_email_address,
    pair_thread_emails,
    parse_email_date,
)


def test_extract_email_address_with_name():
    assert extract_email_address("John Doe <john@example.com>") == "john@example.com"


def test_extract_email_address_plain():
    assert extract_email_address("john@example.com") == "john@example.com"


def test_clean_email_body_removes_signature():
    body = "Hello,\n\nI'd like to order a cake.\n\n--\nJohn Doe\nSent from my iPhone"
    cleaned = clean_email_body(body)
    assert "I'd like to order a cake" in cleaned
    assert "Sent from my iPhone" not in cleaned


def test_clean_email_body_removes_quoted_reply():
    body = "Thanks for letting me know!\n\nOn Mon, Jan 1, 2025 at 10:00 AM Bakery wrote:\n> Previous message"
    cleaned = clean_email_body(body)
    assert "Thanks for letting me know" in cleaned
    assert "Previous message" not in cleaned


def test_clean_email_body_empty():
    assert clean_email_body("") == ""
    assert clean_email_body(None) == ""


def test_parse_email_date_standard():
    dt = parse_email_date("Mon, 15 Jan 2025 10:30:00 +0000")
    assert dt.year == 2025
    assert dt.month == 1
    assert dt.day == 15


def test_parse_email_date_with_timezone_name():
    dt = parse_email_date("Mon, 15 Jan 2025 10:30:00 -0800 (PST)")
    assert dt.year == 2025


def test_pair_thread_emails():
    messages = [
        {"direction": "inbound", "received_at": "2025-01-01T10:00:00Z", "body_text": "Q1"},
        {"direction": "outbound", "received_at": "2025-01-01T11:00:00Z", "body_text": "A1"},
        {"direction": "inbound", "received_at": "2025-01-01T12:00:00Z", "body_text": "Q2"},
        {"direction": "outbound", "received_at": "2025-01-01T13:00:00Z", "body_text": "A2"},
    ]

    pairs = pair_thread_emails(messages, "bakery@example.com")
    assert len(pairs) == 2
    assert pairs[0]["customer"]["body_text"] == "Q1"
    assert pairs[0]["response"]["body_text"] == "A1"
    assert pairs[1]["customer"]["body_text"] == "Q2"
    assert pairs[1]["response"]["body_text"] == "A2"


def test_pair_thread_emails_unanswered():
    messages = [
        {"direction": "inbound", "received_at": "2025-01-01T10:00:00Z", "body_text": "Q1"},
        {"direction": "inbound", "received_at": "2025-01-01T11:00:00Z", "body_text": "Q2"},
        {"direction": "outbound", "received_at": "2025-01-01T12:00:00Z", "body_text": "A2"},
    ]

    pairs = pair_thread_emails(messages, "bakery@example.com")
    # Q1 gets overwritten by Q2 since Q1 was never answered before Q2 came in
    assert len(pairs) == 1
    assert pairs[0]["customer"]["body_text"] == "Q2"
