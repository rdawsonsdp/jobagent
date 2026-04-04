# CLAUDE.md

## Project Overview

JobAgent is an AI-powered job search automation platform. It consists of two main applications in a monorepo:

- **Dashboard** (`/dashboard`): Next.js 16 frontend with React 19, Supabase auth, and Tailwind CSS 4
- **Crawler** (`/crawler`): Python Scrapy-based job scraping orchestrator with Playwright and Claude AI integration

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| Backend API | Next.js App Router API routes |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth with SSR middleware |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) |
| Crawler | Python 3.9+, Scrapy 2.11, Playwright |
| Charts | Recharts 3 |
| Icons | Lucide React |
| Toasts | Sonner |
| Deployment | Vercel (dashboard) |

## Repository Structure

```
jobagent/
├── dashboard/              # Next.js frontend application
│   ├── app/                # App Router pages and API routes
│   │   ├── api/            # REST API endpoints
│   │   ├── jobs/           # Job listings pages
│   │   ├── companies/      # Target companies management
│   │   ├── resume/         # Resume upload/parsing
│   │   ├── auto-apply/     # Auto-apply queue and settings
│   │   ├── pipeline/       # Kanban board for job pipeline
│   │   ├── settings/       # User settings
│   │   ├── crawl-log/      # Crawler activity log
│   │   ├── login/          # Authentication
│   │   └── auth/callback/  # OAuth callback
│   ├── components/         # React components
│   │   ├── layout/         # AppShell, Sidebar, UserMenu
│   │   ├── jobs/           # JobCard, JobFilters, RelevanceScore
│   │   └── pipeline/       # KanbanBoard
│   └── lib/                # Utilities and hooks
│       ├── supabase/       # Supabase client setup and types
│       ├── hooks/          # useJobs, useApplications, useResume
│       ├── auth.ts         # getAuthUserId helper
│       ├── user-context.ts # User profile/preferences context
│       └── preference-learner.ts  # ML job preference learning
├── crawler/                # Python job crawler
│   ├── crawl_orchestrator.py      # Main entry point
│   ├── apply_now.py               # On-demand auto-applier CLI
│   ├── jobcrawler/
│   │   ├── spiders/               # Scrapy spiders
│   │   │   ├── base_spider.py     # Abstract base with shared utils
│   │   │   ├── indeed_spider.py   # Indeed (RSS + Playwright fallback)
│   │   │   ├── linkedin_spider.py # LinkedIn guest API
│   │   │   └── company_spider.py  # Generic company career pages
│   │   ├── playwright_spiders/    # AI-powered application agents
│   │   │   ├── agent_applier.py   # Observe-think-act loop
│   │   │   ├── auto_applier.py    # Easy-apply wrapper
│   │   │   ├── indeed_applier.py  # Indeed-specific
│   │   │   └── linkedin_applier.py # LinkedIn-specific
│   │   ├── ai/                    # Claude AI integration
│   │   │   ├── claude_client.py   # Anthropic SDK wrapper
│   │   │   ├── job_scorer.py      # Relevance scoring (0-10)
│   │   │   ├── resume_parser.py   # Resume extraction
│   │   │   └── cover_letter.py    # Cover letter generation
│   │   ├── db/                    # Database layer
│   │   │   ├── supabase_client.py # Supabase CRUD wrapper
│   │   │   └── queries.py        # SQL constants
│   │   ├── pipelines.py          # 5-stage item pipeline
│   │   ├── items.py              # Scrapy item definitions
│   │   ├── settings.py           # Scrapy configuration
│   │   └── middlewares.py        # UA rotation, retry backoff
│   └── tests/                    # pytest test suite
├── scripts/                # Setup and automation
│   ├── setup.sh            # Environment setup
│   └── install_cron.sh     # Cron scheduling
└── package.json            # Root npm scripts
```

## Development Setup

### Prerequisites
- Node.js (LTS)
- Python 3.9+ (3.11+ recommended)

### Quick Start
```bash
# Full setup (installs deps, creates venv, validates .env)
bash scripts/setup.sh

# Dashboard only
cd dashboard && npm install

# Crawler only
cd crawler && python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
```

### Environment Variables

**Dashboard** (`.env.local` in root or `dashboard/.env`):
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Private service role key
- `ANTHROPIC_API_KEY` - Claude API key

**Crawler** (`crawler/.env`):
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key
- `ANTHROPIC_API_KEY` - Claude API key

## Common Commands

### Dashboard
```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
```

### Crawler
```bash
npm run crawl        # Full crawl (5-hour budget)
npm run crawl:test   # Test crawl (10-minute budget)

# Direct Python usage (from crawler/ with venv active)
python crawl_orchestrator.py --budget 60        # 60-minute crawl
python crawl_orchestrator.py --dry-run           # Dry run
python apply_now.py --item-id <uuid>            # Apply to specific job
python apply_now.py --login linkedin            # Capture login session
python apply_now.py --check-session linkedin    # Verify session
```

### Tests
```bash
cd crawler && python -m pytest tests/           # Run crawler tests
```

### Linting
```bash
cd dashboard && npx next lint                   # ESLint for dashboard
```

## Architecture & Key Patterns

### Dashboard (Next.js)

- **App Router**: All pages under `app/`, file-based routing
- **Auth middleware**: `middleware.ts` redirects unauthenticated users to `/login`
- **Supabase clients**: Server-side via `lib/supabase/server.ts`, browser via `lib/supabase/client.ts`
- **Service role**: Used for bot operations (crawling, scoring) via `createServiceSupabaseClient()`
- **Auth helper**: `getAuthUserId()` in `lib/auth.ts` for API routes
- **Types**: Auto-generated Supabase types in `lib/supabase/types.ts` (do not edit manually)

### Crawler (Scrapy)

- **Pipeline stages** (processed in order):
  1. `CleaningPipeline` (100): HTML stripping, whitespace normalization
  2. `DeduplicationPipeline` (200): URL hash + fuzzy title/company dedup
  3. `ClaudeScorePipeline` (300): AI relevance scoring
  4. `SupabaseWritePipeline` (400): Database persistence
  5. `AutoApplyDetectPipeline` (500): Queue high-scoring easy-apply jobs

- **Spider conventions**: All spiders extend `BaseSpider` with shared utilities (URL normalization, salary extraction, date parsing, time limit checking)
- **Rate limiting**: 5s download delay with randomization, 1 request per domain, autothrottle enabled
- **ROBOTSTXT_OBEY**: True - respects robots.txt

### AI Integration

- **Model**: `claude-sonnet-4-20250514`
- **Max tokens**: 4096
- **Default temperature**: 0.3
- **Use cases**: Job scoring (0-10 relevance), resume parsing, cover letter generation, application form navigation

### Database (Supabase)

Key tables: `jobs`, `resumes`, `search_profiles`, `job_sources`, `crawl_runs`, `auto_apply_queue`, `application_attempts`, `application_events`, `agent_schedules`, `user_profiles`, `target_companies`, `profile_answers`

## Code Conventions

- **TypeScript**: Strict mode enabled, use `bundler` module resolution
- **React**: Functional components with hooks, no class components
- **CSS**: Tailwind CSS 4 utility classes, no separate CSS files
- **Python**: Docstrings on all modules and functions, type hints encouraged
- **Error handling**: Graceful degradation in AI calls (don't crash pipeline on API failures)
- **Naming**: camelCase for TypeScript, snake_case for Python
- **Imports**: Absolute imports with `@/` prefix in dashboard (maps to `dashboard/`)

## Deployment

- **Dashboard**: Deployed to Vercel with root directory set to `dashboard/`
- **Crawler**: Runs locally or via cron (see `scripts/install_cron.sh`)
- **Vercel config**: `dashboard/vercel.json` sets framework to `nextjs`

## Things to Watch Out For

- `lib/supabase/types.ts` is auto-generated - do not edit manually
- Crawler has a 250MB Vercel bundle limit constraint - no Puppeteer/Chromium in dashboard
- Playwright is only used in the crawler, not the dashboard
- The crawler respects robots.txt and uses polite rate limiting - do not disable these
- Environment variables differ between dashboard and crawler (different key names)
