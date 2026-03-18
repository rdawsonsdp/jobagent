-- Enable pgvector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Bakery Email Agent Tables
-- ============================================================

-- Store all historical and incoming emails
CREATE TABLE bakery_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT UNIQUE NOT NULL,
  thread_id TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  received_at TIMESTAMPTZ NOT NULL,
  labels TEXT[] DEFAULT '{}',
  has_attachments BOOLEAN DEFAULT FALSE,
  is_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bakery_emails_thread ON bakery_emails(thread_id);
CREATE INDEX idx_bakery_emails_direction ON bakery_emails(direction);
CREATE INDEX idx_bakery_emails_received ON bakery_emails(received_at DESC);
CREATE INDEX idx_bakery_emails_processed ON bakery_emails(is_processed) WHERE NOT is_processed;

-- Email categories
CREATE TABLE bakery_email_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  auto_reply_enabled BOOLEAN DEFAULT FALSE,
  confidence_threshold FLOAT DEFAULT 0.85,
  example_count INT DEFAULT 0,
  template_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO bakery_email_categories (name, display_name, description, confidence_threshold) VALUES
  ('ordering', 'Ordering', 'How to place orders, order process questions', 0.85),
  ('pricing', 'Pricing', 'Price inquiries for cakes, cupcakes, pastries', 0.85),
  ('availability', 'Availability', 'Product availability, seasonal items', 0.85),
  ('custom_cake', 'Custom Cakes', 'Custom cake design, wedding cakes, special orders', 0.75),
  ('pickup_delivery', 'Pickup & Delivery', 'Pickup hours, delivery areas, shipping', 0.85),
  ('allergens_dietary', 'Allergens & Dietary', 'Gluten-free, vegan, nut-free, allergen info', 0.85),
  ('modification', 'Order Modifications', 'Change order, cancel order, update details', 0.75),
  ('complaint', 'Complaints', 'Damaged items, wrong orders, quality issues', 0.60),
  ('catering', 'Catering & Events', 'Large orders, corporate events, weddings', 0.70),
  ('general_inquiry', 'General Inquiry', 'Everything else', 0.80);

-- Paired question-response from historical threads
CREATE TABLE bakery_email_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  customer_email_id UUID REFERENCES bakery_emails(id) ON DELETE CASCADE,
  response_email_id UUID REFERENCES bakery_emails(id) ON DELETE CASCADE,
  category TEXT REFERENCES bakery_email_categories(name),
  subcategory TEXT,
  quality_score FLOAT DEFAULT 1.0,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bakery_pairs_category ON bakery_email_pairs(category);

-- Agent actions log
CREATE TABLE bakery_email_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID REFERENCES bakery_emails(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('auto_replied', 'drafted', 'escalated')),
  category TEXT REFERENCES bakery_email_categories(name),
  confidence FLOAT,
  draft_response TEXT,
  final_response TEXT,
  similar_examples UUID[] DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'edited', 'rejected', 'sent')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bakery_actions_status ON bakery_email_actions(status);
CREATE INDEX idx_bakery_actions_created ON bakery_email_actions(created_at DESC);

-- Bakery configuration (editable from dashboard)
CREATE TABLE bakery_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default config
INSERT INTO bakery_config (key, value) VALUES
  ('bakery_name', '"Your Bakery Name"'),
  ('hours', '{"monday": "7am-6pm", "tuesday": "7am-6pm", "wednesday": "7am-6pm", "thursday": "7am-6pm", "friday": "7am-7pm", "saturday": "8am-5pm", "sunday": "closed"}'),
  ('contact', '{"phone": "", "email": "", "address": ""}'),
  ('ordering_process', '"Visit our website or call to place an order. Custom cakes require 48 hours notice."'),
  ('delivery_policy', '"We deliver within 15 miles. Delivery fee starts at $10. Free delivery for orders over $100."'),
  ('cancellation_policy', '"Orders can be cancelled up to 24 hours before pickup/delivery for a full refund."'),
  ('allergen_info', '"We handle wheat, dairy, eggs, nuts, and soy in our facility. Cross-contamination is possible. Please inform us of all allergies."'),
  ('menu_highlights', '[]'),
  ('auto_reply_enabled', 'true'),
  ('max_auto_replies_per_hour', '50'),
  ('escalation_keywords', '["lawyer", "attorney", "health department", "allergic reaction", "hospital", "lawsuit", "food poisoning"]'),
  ('blocklist_addresses', '[]');

-- RLS policies
ALTER TABLE bakery_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE bakery_email_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bakery_email_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE bakery_email_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bakery_config ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by Python agent)
CREATE POLICY "Service role full access" ON bakery_emails FOR ALL USING (true);
CREATE POLICY "Service role full access" ON bakery_email_pairs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON bakery_email_categories FOR ALL USING (true);
CREATE POLICY "Service role full access" ON bakery_email_actions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON bakery_config FOR ALL USING (true);

-- Similarity search function using pgvector
CREATE OR REPLACE FUNCTION match_email_pairs(
  query_embedding VECTOR(1024),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5,
  filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  thread_id TEXT,
  customer_email_id UUID,
  response_email_id UUID,
  category TEXT,
  quality_score FLOAT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.thread_id,
    p.customer_email_id,
    p.response_email_id,
    p.category,
    p.quality_score,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM bakery_email_pairs p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
    AND (filter_category IS NULL OR p.category = filter_category)
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
