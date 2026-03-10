"""
Crawl orchestrator -- main entry point for the job search crawler.

Manages the full crawl lifecycle within a configurable time budget:
  a) Create crawl_run record
  b) Load search profiles and job sources
  c) Allocate time per source based on priority
  d) Run spiders sequentially with time limits (Scrapy CrawlerProcess)
  e) Run auto-applier for approved items
  f) Update crawl_run with stats
  g) Support --budget CLI arg for test runs (minutes)
  h) Logging to crawler/logs/ directory

Usage:
    python crawl_orchestrator.py                  # Full 5-hour run
    python crawl_orchestrator.py --budget 30      # 30-minute test run
    python crawl_orchestrator.py --dry-run        # Auto-applier in dry-run mode
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Ensure project root is on the path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# Load environment
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "crawler" / ".env")

from scrapy.crawler import CrawlerRunner
from scrapy.utils.project import get_project_settings

# Install the asyncio reactor BEFORE any other Twisted imports
# This is required for scrapy-playwright compatibility
import scrapy.utils.reactor
scrapy.utils.reactor.install_reactor("twisted.internet.asyncioreactor.AsyncioSelectorReactor")

from twisted.internet import reactor, defer

from jobcrawler.db.supabase_client import SupabaseDB
from jobcrawler.db.queries import build_crawl_summary_update
from jobcrawler.playwright_spiders.auto_applier import run_auto_applier

logger = logging.getLogger(__name__)

# Default time budget: 5 hours in seconds
DEFAULT_BUDGET_SECONDS = 5 * 60 * 60

# Fraction of total budget reserved for auto-applier
AUTO_APPLY_BUDGET_FRACTION = 0.10  # 10%

# Spider class mapping
SPIDER_MAP = {
    "linkedin": "jobcrawler.spiders.linkedin_spider.LinkedInSpider",
    "indeed": "jobcrawler.spiders.indeed_spider.IndeedSpider",
    "company": "jobcrawler.spiders.company_spider.CompanySpider",
}


def setup_logging(log_dir: Path, level: int = logging.INFO) -> None:
    """Configure logging to file and console."""
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"crawl_{timestamp}.log"

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # File handler
    file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
    file_handler.setLevel(level)
    file_formatter = logging.Formatter(
        "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )
    file_handler.setFormatter(file_formatter)

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_formatter = logging.Formatter(
        "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )
    console_handler.setFormatter(console_formatter)

    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    logger.info("Logging to: %s", log_file)


def allocate_time(
    sources: list[dict[str, Any]],
    total_seconds: int,
) -> list[dict[str, Any]]:
    """
    Allocate crawl time per source based on priority.

    Higher priority sources get proportionally more time.
    Each source gets at least 60 seconds.

    Args:
        sources: List of source config dicts with 'priority' field.
        total_seconds: Total seconds available for crawling.

    Returns:
        List of source dicts with added 'time_limit' field (seconds).
    """
    if not sources:
        return []

    total_priority = sum(s.get("priority", 1) for s in sources)
    if total_priority == 0:
        total_priority = len(sources)

    min_time = 60  # minimum 60 seconds per source
    allocated: list[dict[str, Any]] = []

    for source in sources:
        priority = source.get("priority", 1)
        fraction = priority / total_priority
        time_limit = max(min_time, int(total_seconds * fraction))
        source_with_time = {**source, "time_limit": time_limit}
        allocated.append(source_with_time)

    # Adjust if total exceeds budget
    total_allocated = sum(s["time_limit"] for s in allocated)
    if total_allocated > total_seconds and total_seconds > 0:
        scale = total_seconds / total_allocated
        for s in allocated:
            s["time_limit"] = max(min_time, int(s["time_limit"] * scale))

    return allocated


def build_spider_configs(
    search_profiles: list[dict[str, Any]],
    job_sources: list[dict[str, Any]],
    total_crawl_seconds: int,
) -> list[dict[str, Any]]:
    """
    Build a list of spider run configurations from search profiles and sources.

    Each config has: spider_name, spider_cls, kwargs (query, location, time_limit, etc.)

    job_sources from DB have: name (LinkedIn/Indeed/Greenhouse/Lever/Workday),
    source_type (scrapy/playwright), enabled (bool), priority (1-10).
    search_profiles have: job_titles[], keywords[], locations[], remote_only.
    """
    configs: list[dict[str, Any]] = []

    # Match sources by name (DB values: LinkedIn, Indeed, Greenhouse, Lever, Workday)
    source_by_name = {s.get("name", "").lower(): s for s in job_sources}

    linkedin_source = source_by_name.get("linkedin")
    indeed_source = source_by_name.get("indeed")
    company_sources = [
        s for s in job_sources
        if s.get("name", "").lower() not in ("linkedin", "indeed")
    ]

    # Calculate time for board spiders vs company spiders
    # Board spiders get 60% of time, company spiders get 40%
    board_time = int(total_crawl_seconds * 0.6)
    company_time = int(total_crawl_seconds * 0.4)

    # Build query string from search profile fields
    for profile in search_profiles:
        job_titles = profile.get("job_titles", [])
        keywords = profile.get("keywords", [])
        locations = profile.get("locations", ["United States"])

        # Build a search query from job titles + keywords
        query_parts = job_titles + keywords
        query = " ".join(query_parts[:5]) if query_parts else "Data Architect"
        location = locations[0] if locations else "United States"
        source_priority = profile.get("min_relevance_score", 5)

        # LinkedIn spider
        if linkedin_source and linkedin_source.get("enabled", False):
            time_per_board = board_time // max(1, len(search_profiles) * 2)
            configs.append({
                "spider_name": "linkedin",
                "spider_cls": SPIDER_MAP["linkedin"],
                "priority": linkedin_source.get("priority", 5),
                "kwargs": {
                    "query": query,
                    "location": location,
                    "time_limit": time_per_board,
                    "max_pages": 10,
                },
            })

        # Indeed spider
        if indeed_source and indeed_source.get("enabled", False):
            time_per_board = board_time // max(1, len(search_profiles) * 2)
            configs.append({
                "spider_name": "indeed",
                "spider_cls": SPIDER_MAP["indeed"],
                "priority": indeed_source.get("priority", 5),
                "kwargs": {
                    "query": query,
                    "location": location,
                    "time_limit": time_per_board,
                    "max_pages": 10,
                },
            })

    # Company spider (single run that iterates all company sources)
    active_company_sources = [s for s in company_sources if s.get("enabled", False)]
    if active_company_sources:
        configs.append({
            "spider_name": "company",
            "spider_cls": SPIDER_MAP["company"],
            "priority": 5,
            "kwargs": {
                "time_limit": company_time,
            },
        })

    # Sort by priority (highest first)
    configs.sort(key=lambda c: c.get("priority", 0), reverse=True)

    return configs


class CrawlOrchestrator:
    """
    Main orchestrator that manages the full crawl lifecycle.

    Coordinates spider runs, time budgeting, and stats tracking.
    """

    def __init__(
        self,
        budget_minutes: int | None = None,
        dry_run: bool = True,
    ) -> None:
        if budget_minutes is not None:
            self.total_budget = budget_minutes * 60
        else:
            self.total_budget = DEFAULT_BUDGET_SECONDS

        self.dry_run = dry_run
        self.db = SupabaseDB()
        self.crawl_run_id: str | None = None
        self.start_time: float = 0.0

        # Stats
        self.stats = {
            "total_jobs_found": 0,
            "new_jobs_added": 0,
            "duplicates_skipped": 0,
            "errors": 0,
            "spiders_run": 0,
            "auto_applies": 0,
        }

    def remaining_seconds(self) -> int:
        """Calculate remaining time in the budget."""
        if self.start_time == 0:
            return self.total_budget
        elapsed = time.time() - self.start_time
        return max(0, int(self.total_budget - elapsed))

    def run(self) -> dict[str, Any]:
        """
        Execute the full crawl orchestration.

        Returns:
            Summary dict with crawl stats.
        """
        self.start_time = time.time()

        logger.info(
            "Starting crawl orchestration (budget: %d minutes, dry_run: %s)",
            self.total_budget // 60,
            self.dry_run,
        )

        # Step a) Create crawl_run record
        self._create_crawl_run()

        try:
            # Step b) Load search profiles and job sources
            search_profiles = self._load_search_profiles()
            job_sources = self._load_job_sources()

            if not search_profiles:
                logger.warning("No active search profiles found. Using defaults.")
                search_profiles = [{
                    "job_titles": ["Data Architect", "Oracle Data Engineer"],
                    "keywords": ["Oracle", "data architecture", "ETL", "SQL"],
                    "locations": ["United States"],
                    "remote_only": False,
                }]

            # Step c) Allocate time per source based on priority
            crawl_time = int(self.total_budget * (1 - AUTO_APPLY_BUDGET_FRACTION))
            auto_apply_time = self.total_budget - crawl_time

            spider_configs = build_spider_configs(
                search_profiles, job_sources, crawl_time
            )

            logger.info(
                "Planned %d spider runs (crawl: %dm, auto-apply: %dm)",
                len(spider_configs),
                crawl_time // 60,
                auto_apply_time // 60,
            )

            # Step d) Run spiders sequentially in a single reactor
            self._run_all_spiders(spider_configs)

            # Step e) Run auto-applier for approved items
            if self.remaining_seconds() > 30:
                self._run_auto_applier()

            # Step f) Update crawl_run with stats
            self._complete_crawl_run("completed")

        except KeyboardInterrupt:
            logger.info("Crawl interrupted by user.")
            self._complete_crawl_run("cancelled")
        except Exception as e:
            logger.error("Crawl failed: %s", e, exc_info=True)
            self.stats["errors"] += 1
            self._complete_crawl_run("failed")

        elapsed = time.time() - self.start_time
        logger.info(
            "Crawl orchestration complete in %.1f minutes. Stats: %s",
            elapsed / 60,
            self.stats,
        )

        return self.stats

    def _create_crawl_run(self) -> None:
        """Create a crawl_run record in Supabase."""
        try:
            result = self.db.create_crawl_run({
                "started_at": datetime.utcnow().isoformat(),
                "status": "running",
                "total_jobs_found": 0,
                "new_jobs_added": 0,
                "duplicates_skipped": 0,
                "errors": 0,
            })
            self.crawl_run_id = result.get("id")
            logger.info("Created crawl run: %s", self.crawl_run_id)
        except Exception as e:
            logger.error("Failed to create crawl_run record: %s", e)

    def _complete_crawl_run(self, status: str) -> None:
        """Update the crawl_run record with final stats."""
        if not self.crawl_run_id:
            return

        try:
            update_data = build_crawl_summary_update(
                self.crawl_run_id,
                total_jobs_found=self.stats["total_jobs_found"],
                new_jobs_added=self.stats["new_jobs_added"],
                duplicates_skipped=self.stats["duplicates_skipped"],
                errors=self.stats["errors"],
                status=status,
            )
            self.db.update_crawl_run(self.crawl_run_id, update_data)
            logger.info("Updated crawl run %s: %s", self.crawl_run_id, status)
        except Exception as e:
            logger.error("Failed to update crawl_run: %s", e)

    def _load_search_profiles(self) -> list[dict[str, Any]]:
        """Load active search profiles from Supabase."""
        try:
            profiles = self.db.get_search_profiles()
            logger.info("Loaded %d active search profiles", len(profiles))
            return profiles
        except Exception as e:
            logger.error("Failed to load search profiles: %s", e)
            return []

    def _load_job_sources(self) -> list[dict[str, Any]]:
        """Load active job sources from Supabase."""
        try:
            sources = self.db.get_active_job_sources()
            logger.info("Loaded %d active job sources", len(sources))
            return sources
        except Exception as e:
            logger.error("Failed to load job sources: %s", e)
            return []

    def _run_all_spiders(self, configs: list[dict[str, Any]]) -> None:
        """Run all spiders sequentially in a single Twisted reactor session."""
        os.environ.setdefault("SCRAPY_SETTINGS_MODULE", "jobcrawler.settings")
        settings = get_project_settings()
        settings.set("LOG_LEVEL", "INFO")

        runner = CrawlerRunner(settings)

        @defer.inlineCallbacks
        def crawl_sequentially():
            for config in configs:
                spider_name = config["spider_name"]
                kwargs = config.get("kwargs", {})

                remaining = self.remaining_seconds()
                if remaining <= 10:
                    logger.info("Time budget exhausted. Stopping spider runs.")
                    break

                time_limit = min(kwargs.get("time_limit", remaining), remaining)

                kwargs["time_limit"] = time_limit

                logger.info(
                    "Running spider '%s' (time_limit: %ds, kwargs: %s)",
                    spider_name,
                    time_limit,
                    {k: v for k, v in kwargs.items() if k != "time_limit"},
                )

                try:
                    spider_cls = self._import_spider_class(config["spider_cls"])
                    yield runner.crawl(spider_cls, **kwargs)
                    self.stats["spiders_run"] += 1
                    logger.info("Spider '%s' completed", spider_name)
                except Exception as e:
                    logger.error("Spider '%s' failed: %s", spider_name, e, exc_info=True)
                    self.stats["errors"] += 1

            reactor.stop()

        crawl_sequentially()
        reactor.run(installSignalHandlers=False)

    @staticmethod
    def _import_spider_class(class_path: str) -> type:
        """Dynamically import a spider class from its dotted path."""
        module_path, class_name = class_path.rsplit(".", 1)
        import importlib
        module = importlib.import_module(module_path)
        return getattr(module, class_name)

    def _run_auto_applier(self) -> None:
        """Run the auto-applier for approved items."""
        logger.info("Running auto-applier (dry_run=%s)", self.dry_run)

        try:
            summary = run_auto_applier(
                dry_run=self.dry_run,
                max_daily=10,
                max_per_company_per_week=1,
            )
            self.stats["auto_applies"] = summary.get("submitted", 0)
            logger.info("Auto-applier complete: %s", summary)
        except Exception as e:
            logger.error("Auto-applier failed: %s", e, exc_info=True)
            self.stats["errors"] += 1


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Job search crawl orchestrator",
    )
    parser.add_argument(
        "--budget",
        type=int,
        default=None,
        help="Time budget in minutes (default: 300 = 5 hours)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Run auto-applier in dry-run mode (default: True)",
    )
    parser.add_argument(
        "--no-dry-run",
        action="store_true",
        default=False,
        help="Disable dry-run mode for auto-applier",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Logging level (default: INFO)",
    )

    args = parser.parse_args()

    # Setup logging
    log_dir = PROJECT_ROOT / "logs"
    log_level = getattr(logging, args.log_level)
    setup_logging(log_dir, level=log_level)

    # Determine dry_run mode
    dry_run = not args.no_dry_run

    # Run orchestrator
    orchestrator = CrawlOrchestrator(
        budget_minutes=args.budget,
        dry_run=dry_run,
    )
    stats = orchestrator.run()

    # Exit with appropriate code
    if stats.get("errors", 0) > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
