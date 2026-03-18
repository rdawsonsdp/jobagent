# Bakery Email Agent - Implementation Plan

## Problem
- 400+ customer emails/day
- ~90% are routine/repetitive (ordering, pricing, availability, pickup times, custom cake inquiries)
- Most go unanswered or get delayed 1-2 day responses
- Staff time wasted on copy-paste replies

## Solution
An AI-powered email agent that:
1. **Learns** from your historical email threads (past Q&A pairs)
2. **Classifies** incoming emails into categories
3. **Drafts or auto-sends** responses based on learned patterns
4. **Escalates** the 10% that need human attention
5. **Improves** over time as staff approve/edit drafts

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Gmail API   │────▶│  Email Ingestion  │────▶│  Supabase DB    │
│  (IMAP/OAuth)│     │  Service (Python) │     │  (emails table) │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                    ┌──────────────────┐               │
                    │  Classification   │◀──────────────┘
                    │  Engine (Claude)  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Response Engine  │
                    │  (RAG + Claude)   │
                    │  - Vector search  │
                    │  - Few-shot from  │
                    │    past replies   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │Auto-Send │  │Draft for │  │Escalate  │
        │(high     │  │Review    │  │to Human  │
        │confidence│  │(medium)  │  │(complex) │
        └──────────┘  └──────────┘  └──────────┘
                             │
                    ┌────────▼─────────┐
                    │  Dashboard UI    │
                    │  (Next.js)       │
                    │  - Review drafts │
                    │  - Approve/edit  │
                    │  - Analytics     │
                    └──────────────────┘
```

---

## Phase 1: Data Foundation (Learn from History)

### 1.1 Email Import & Storage

**New Supabase tables:**

```sql
-- Store all historical and incoming emails
CREATE TABLE bakery_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT UNIQUE NOT NULL,        -- Gmail message ID
  thread_id TEXT NOT NULL,                -- Gmail thread ID
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,                         -- Plain text body
  body_html TEXT,                         -- HTML body (for reference)
  direction TEXT NOT NULL,                -- 'inbound' | 'outbound'
  received_at TIMESTAMPTZ NOT NULL,
  labels TEXT[],                          -- Gmail labels
  has_attachments BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Paired Q&A from historical threads
CREATE TABLE bakery_email_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  customer_email_id UUID REFERENCES bakery_emails(id),
  response_email_id UUID REFERENCES bakery_emails(id),
  category TEXT,                          -- auto-classified category
  subcategory TEXT,
  quality_score FLOAT,                    -- how good was the original response
  embedding VECTOR(1536),                 -- for similarity search
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email categories learned from history
CREATE TABLE bakery_email_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                     -- e.g. 'cake_ordering'
  display_name TEXT NOT NULL,             -- e.g. 'Cake Ordering'
  description TEXT,                       -- what kind of emails fall here
  auto_reply_enabled BOOLEAN DEFAULT FALSE,
  confidence_threshold FLOAT DEFAULT 0.85,
  example_count INT DEFAULT 0,
  template_response TEXT,                 -- optional static template
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track agent actions and human feedback
CREATE TABLE bakery_email_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID REFERENCES bakery_emails(id),
  action TEXT NOT NULL,                   -- 'auto_replied' | 'drafted' | 'escalated'
  category TEXT,
  confidence FLOAT,
  draft_response TEXT,
  final_response TEXT,                    -- what actually got sent (after human edit)
  status TEXT DEFAULT 'pending',          -- 'pending' | 'approved' | 'edited' | 'rejected'
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.2 Gmail Integration (Python)

**New module: `email_agent/`** (sibling to `crawler/`)

```
email_agent/
├── __init__.py
├── gmail_client.py          # Gmail API OAuth2 + IMAP
├── email_importer.py        # Bulk import historical emails
├── email_parser.py          # Extract clean text, thread pairing
├── classifier.py            # Claude-powered email classification
├── response_engine.py       # RAG-based response generation
├── agent_loop.py            # Main polling loop (check inbox every 2 min)
├── confidence.py            # Confidence scoring logic
├── config.py                # Bakery-specific config (hours, menu, policies)
└── tests/
    ├── test_classifier.py
    ├── test_response_engine.py
    └── test_email_parser.py
```

**gmail_client.py** responsibilities:
- OAuth2 authentication with Gmail API
- Fetch emails (historical bulk + real-time polling)
- Send replies (threading properly with In-Reply-To headers)
- Label management (mark as processed, needs-review, etc.)

### 1.3 Historical Email Import Pipeline

```python
# email_importer.py - high level flow
def import_historical_emails(days_back=365):
    """
    1. Connect to Gmail via API
    2. Fetch all threads from last N days
    3. Parse each thread into individual messages
    4. Store in bakery_emails table
    5. Pair customer questions with staff responses → bakery_email_pairs
    6. Classify each pair using Claude
    7. Generate embeddings for similarity search
    """
```

---

## Phase 2: Intelligence Layer

### 2.1 Email Classification

**Categories (auto-discovered from history, but seeded with):**

| Category | Examples | Auto-reply? |
|----------|----------|-------------|
| `ordering` | "How do I order a cake?" "Can I place an order?" | Yes |
| `pricing` | "How much is a 3-tier cake?" "What are your prices?" | Yes |
| `availability` | "Do you have red velvet?" "Are you open Saturday?" | Yes |
| `custom_cake` | "I need a custom cake for my wedding" | Draft |
| `pickup_delivery` | "What are your pickup hours?" "Do you deliver?" | Yes |
| `allergens_dietary` | "Do you have gluten-free options?" | Yes |
| `modification` | "Can I change my order?" "Cancel my order" | Draft |
| `complaint` | "My cake was damaged" "Not what I ordered" | Escalate |
| `catering` | "We need 200 cupcakes for an event" | Draft |
| `general_inquiry` | Everything else | Draft |

**Classification approach:**
```python
# classifier.py
def classify_email(email_text: str, categories: list) -> dict:
    """
    Uses Claude with few-shot examples from bakery_email_pairs.
    Returns:
      {
        "category": "ordering",
        "subcategory": "cake_order",
        "confidence": 0.94,
        "intent": "Customer wants to know how to place a cake order",
        "key_details": {"product": "birthday cake", "date": "March 25"}
      }
    """
```

### 2.2 Response Generation (RAG + Claude)

The core intelligence: find similar past emails and use them as few-shot examples.

```python
# response_engine.py
def generate_response(incoming_email: dict, category: str) -> dict:
    """
    1. Vector search: find 5 most similar past customer emails
       from bakery_email_pairs (using embedding similarity)
    2. Retrieve the actual staff responses to those emails
    3. Build a Claude prompt with:
       - Bakery context (menu, hours, policies from config.py)
       - The 5 similar Q&A pairs as few-shot examples
       - The new incoming email
    4. Claude generates a response in the bakery's voice/tone
    5. Return response + confidence score
    """
    return {
        "draft_response": "...",
        "confidence": 0.91,
        "similar_examples_used": [...],
        "action": "auto_send" | "needs_review" | "escalate"
    }
```

**Confidence thresholds (configurable per category):**
- **≥ 0.90**: Auto-send (after initial supervised period)
- **0.70 - 0.89**: Draft for human review
- **< 0.70**: Escalate to human

### 2.3 Bakery Knowledge Base

```python
# config.py - static bakery info injected into every prompt
BAKERY_CONFIG = {
    "name": "...",
    "hours": {...},
    "menu": {...},           # Products, prices, sizes
    "ordering_process": "...",
    "delivery_policy": "...",
    "allergen_info": {...},
    "custom_cake_process": "...",
    "cancellation_policy": "...",
    "contact_info": {...},
}
```

This gets stored in a `bakery_config` Supabase table so it's editable from the dashboard.

---

## Phase 3: Agent Loop

### 3.1 Main Processing Loop

```python
# agent_loop.py
async def run_email_agent():
    """
    Every 2 minutes:
    1. Poll Gmail for new unprocessed emails
    2. For each new email:
       a. Parse and store in bakery_emails
       b. Classify with classifier.py
       c. Generate response with response_engine.py
       d. Based on confidence:
          - High: auto-send reply via Gmail API
          - Medium: save draft for review
          - Low: flag for human escalation
       e. Log action in bakery_email_actions
    3. Check for any human-reviewed drafts → send approved ones
    """
```

### 3.2 Learning Loop

```python
# When a human approves/edits a draft:
def on_human_feedback(action_id, final_response, was_edited):
    """
    1. Store the final_response in bakery_email_actions
    2. If approved without edits → boost confidence for this category
    3. If edited → store the edit as a new training example
    4. If rejected → lower confidence, analyze why
    5. Re-compute embeddings for the new pair
    6. Update category stats
    """
```

---

## Phase 4: Dashboard UI

### 4.1 New Dashboard Pages

```
dashboard/app/
├── email-agent/
│   ├── page.tsx              # Email agent overview/dashboard
│   ├── inbox/page.tsx        # Live inbox view with AI annotations
│   ├── review/page.tsx       # Drafts needing human approval
│   ├── history/page.tsx      # Sent responses log
│   ├── categories/page.tsx   # Manage email categories
│   ├── config/page.tsx       # Bakery info (hours, menu, policies)
│   └── analytics/page.tsx    # Response times, auto-reply rates, etc.
```

### 4.2 Key UI Components

**Email Review Queue** (`review/page.tsx`):
- List of drafts awaiting approval
- Side-by-side: customer email | AI draft response
- One-click approve, edit-and-send, or reject
- Show confidence score and similar examples used
- Keyboard shortcuts for fast review (j/k navigate, a approve, e edit)

**Analytics Dashboard** (`analytics/page.tsx`):
- Emails processed today/week/month
- Auto-reply rate (% handled without human)
- Average response time (before vs after agent)
- Category breakdown pie chart
- Confidence distribution histogram
- Human edit rate (how often drafts get modified)

**Category Manager** (`categories/page.tsx`):
- View all learned categories
- Toggle auto-reply on/off per category
- Adjust confidence thresholds
- View example emails per category
- Add/merge/split categories

**Bakery Config** (`config/page.tsx`):
- Edit hours, menu, prices, policies
- These feed directly into the AI prompt context
- Preview how changes affect response generation

---

## Phase 5: Deployment & Operations

### 5.1 Infrastructure

- **Email Agent Process**: Python service running on a small VM or Railway/Render
  - Polls Gmail every 2 minutes
  - Can also run as a cron job if preferred
- **Dashboard**: Existing Vercel deployment (add new pages)
- **Database**: Existing Supabase instance (add new tables)
- **Vector Search**: Supabase pgvector extension (already available)

### 5.2 Safety & Guardrails

1. **Supervised Mode First**: Start with ALL emails going to draft/review
2. **Gradual Auto-send**: Enable auto-send per category only after 50+ approved drafts
3. **Daily Digest**: Email summary of all auto-sent replies for spot-checking
4. **Kill Switch**: One-click disable auto-replies from dashboard
5. **Rate Limiting**: Max 50 auto-sends/hour (prevent runaway)
6. **Blocklist**: Never auto-reply to certain addresses (vendors, partners)
7. **Escalation Keywords**: Always escalate if email mentions "lawyer", "health department", "allergic reaction", etc.

### 5.3 Rollout Plan

| Week | Milestone |
|------|-----------|
| 1 | Gmail integration + historical import + DB schema |
| 2 | Classification engine + response generation |
| 3 | Agent loop (draft-only mode) + review UI |
| 4 | Staff testing: review and approve/edit drafts |
| 5 | Enable auto-send for top 2-3 categories |
| 6 | Analytics dashboard + expand auto-send categories |
| 7+ | Continuous improvement from feedback loop |

---

## Technical Implementation Order

### Step 1: Database Schema
- Create all Supabase tables and enable pgvector
- Add RLS policies

### Step 2: Gmail Client
- OAuth2 setup with Google Cloud Console
- Email fetching (historical + polling)
- Email sending (threaded replies)

### Step 3: Historical Import
- Bulk import past emails
- Thread pairing (match questions to responses)
- Generate embeddings via Claude/OpenAI

### Step 4: Classification Engine
- Claude-based classifier with few-shot examples
- Category auto-discovery from historical data

### Step 5: Response Engine
- Vector similarity search for relevant past Q&A
- Claude response generation with bakery context
- Confidence scoring

### Step 6: Agent Loop
- Polling service
- Action routing (auto-send / draft / escalate)
- Gmail reply sending

### Step 7: Dashboard - Review Queue
- Draft review UI with approve/edit/reject
- Feedback loop integration

### Step 8: Dashboard - Analytics & Config
- Metrics and charts
- Category management
- Bakery config editor

---

## Key Design Decisions

1. **Why RAG over fine-tuning?** RAG with few-shot examples adapts immediately as new emails are processed. No retraining needed. New menu items or policy changes just update the config.

2. **Why Gmail API over IMAP?** Better threading support, labels, OAuth2 security, and sending capabilities. Also supports push notifications later.

3. **Why confidence tiers?** Builds trust gradually. Staff see the agent is accurate before trusting it to auto-send.

4. **Why Supabase pgvector?** Already using Supabase. No need for a separate vector DB. pgvector handles the scale (thousands of email pairs) easily.

5. **Why Python for the agent?** Matches existing crawler codebase, better Gmail API libraries, and Claude SDK already integrated.
