"""
Scrapy settings for the jobcrawler project.

Configures bot behavior, download delays, user-agent rotation,
item pipelines, and Playwright integration.
"""

import logging
from fake_useragent import UserAgent

BOT_NAME = "jobcrawler"

SPIDER_MODULES = ["jobcrawler.spiders"]
NEWSPIDER_MODULE = "jobcrawler.spiders"

# Obey robots.txt
ROBOTSTXT_OBEY = True

# Download delay and randomization (3-7s effective range)
DOWNLOAD_DELAY = 5
RANDOMIZE_DOWNLOAD_DELAY = True  # Scrapy uses 0.5*DELAY to 1.5*DELAY => 2.5s - 7.5s

# Concurrency limits
CONCURRENT_REQUESTS = 4
CONCURRENT_REQUESTS_PER_DOMAIN = 1

# User-Agent rotation via fake_useragent
_ua = UserAgent(browsers=["chrome", "firefox", "edge"], os=["windows", "macos", "linux"])
USER_AGENT = _ua.random

# Downloader middlewares
DOWNLOADER_MIDDLEWARES = {
    "jobcrawler.middlewares.RotateUserAgentMiddleware": 400,
    "jobcrawler.middlewares.ExponentialBackoffRetryMiddleware": 550,
    "scrapy.downloadermiddlewares.useragent.UserAgentMiddleware": None,
    "scrapy.downloadermiddlewares.retry.RetryMiddleware": None,
}

# Item pipelines: cleaning -> dedup -> scoring -> db write -> auto-apply detect
ITEM_PIPELINES = {
    "jobcrawler.pipelines.CleaningPipeline": 100,
    "jobcrawler.pipelines.DeduplicationPipeline": 200,
    "jobcrawler.pipelines.ClaudeScorePipeline": 300,
    "jobcrawler.pipelines.SupabaseWritePipeline": 400,
    "jobcrawler.pipelines.AutoApplyDetectPipeline": 500,
}

# Logging
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"

# Playwright download handlers for JavaScript-rendered pages
DOWNLOAD_HANDLERS = {
    "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
}

TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

# Playwright launch options
PLAYWRIGHT_BROWSER_TYPE = "chromium"
PLAYWRIGHT_LAUNCH_OPTIONS = {
    "headless": True,
}
PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT = 30000  # 30 seconds

# Request fingerprinting
REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"

# Feed exports encoding
FEED_EXPORT_ENCODING = "utf-8"

# AutoThrottle (complementary to DOWNLOAD_DELAY)
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 3
AUTOTHROTTLE_MAX_DELAY = 15
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0

# Retry settings (handled by custom middleware)
RETRY_ENABLED = False  # Disabled in favor of custom ExponentialBackoffRetryMiddleware
