"""
Scrapy Item definitions for job listings.

Defines the JobItem class with all fields collected from
job board spiders and processed through pipelines.
"""

import scrapy


class JobItem(scrapy.Item):
    """Represents a single job listing scraped from any source."""

    # Unique identifier from the source platform
    external_id = scrapy.Field()

    # Job listing URL
    url = scrapy.Field()

    # Job title
    title = scrapy.Field()

    # Company name
    company = scrapy.Field()

    # Location string (e.g. "San Francisco, CA" or "Remote")
    location = scrapy.Field()

    # Whether the job is remote
    is_remote = scrapy.Field()

    # Salary range (parsed)
    salary_min = scrapy.Field()
    salary_max = scrapy.Field()

    # Raw salary text as displayed on the listing
    salary_text = scrapy.Field()

    # Full HTML of the job description
    description_html = scrapy.Field()

    # Plain text version of the description (populated by CleaningPipeline)
    description_text = scrapy.Field()

    # Date the job was posted (normalized to YYYY-MM-DD by CleaningPipeline)
    posted_date = scrapy.Field()

    # List of keywords/tags associated with the listing
    keywords = scrapy.Field()

    # Whether the listing supports easy/quick apply
    easy_apply = scrapy.Field()

    # Name of the source (e.g. "linkedin", "indeed", "greenhouse")
    source_name = scrapy.Field()

    # Raw scraped data dict for debugging/reprocessing
    raw_data = scrapy.Field()

    # --- Fields populated by pipelines ---

    # SHA256 hash of normalized URL (set by DeduplicationPipeline)
    url_hash = scrapy.Field()

    # Relevance score 0-10 (set by ClaudeScorePipeline)
    relevance_score = scrapy.Field()

    # Explanation of the score (set by ClaudeScorePipeline)
    score_reasoning = scrapy.Field()

    # Keywords from resume matched in the listing
    keywords_matched = scrapy.Field()

    # Keywords from resume missing from the listing
    keywords_missing = scrapy.Field()

    # Supabase source_id (resolved by SupabaseWritePipeline)
    source_id = scrapy.Field()

    # Supabase record ID (set by SupabaseWritePipeline after insert)
    db_id = scrapy.Field()
