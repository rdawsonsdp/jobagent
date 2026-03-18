"""
CLI script to import historical emails from Gmail.

Usage:
    python -m email_agent.import_emails --days 365
    python -m email_agent.import_emails --days 30  # Just last month
"""

from __future__ import annotations

import argparse
import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv
from supabase import create_client

from email_agent.classifier import EmailClassifier
from email_agent.config import BakeryConfig
from email_agent.email_importer import EmailImporter
from email_agent.gmail_client import GmailClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Import historical bakery emails")
    parser.add_argument(
        "--days", type=int, default=365, help="Number of days to look back (default: 365)"
    )
    parser.add_argument(
        "--batch-size", type=int, default=100, help="Batch size for Gmail API (default: 100)"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Initialize clients
    gmail = GmailClient()
    gmail.authenticate()

    supabase = create_client(
        os.getenv("SUPABASE_URL", ""),
        os.getenv("SUPABASE_SERVICE_KEY", ""),
    )

    anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

    # Load categories from DB
    categories_result = supabase.table("bakery_email_categories").select("*").execute()
    classifier = EmailClassifier(anthropic, categories_result.data or [])

    config = BakeryConfig(supabase)
    config.load()

    # Run import
    importer = EmailImporter(gmail, supabase, classifier, config)
    stats = importer.import_historical(days_back=args.days, batch_size=args.batch_size)

    print(f"\nImport complete!")
    print(f"  Threads processed: {stats['threads']}")
    print(f"  Emails stored:     {stats['emails']}")
    print(f"  Q&A pairs created: {stats['pairs']}")
    print(f"  Errors:            {stats['errors']}")


if __name__ == "__main__":
    main()
