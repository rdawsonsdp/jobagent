import { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const RECOMPUTE_THRESHOLD = 5; // minimum new signals before recomputing
const RECOMPUTE_HOURS = 24; // max hours before forcing recompute

const SYNTHESIS_PROMPT = `You are analyzing a job seeker's behavior to understand their true preferences.

You have two sets of jobs:
1. POSITIVE signals (jobs they applied to, saved, or queued for auto-apply)
2. NEGATIVE signals (jobs they dismissed or deleted)

Each job has: title, company, location, is_remote, relevance_score

Analyze the patterns and produce ONLY valid JSON:

{
  "preferred_titles": ["title patterns they gravitate toward"],
  "avoided_titles": ["title patterns they consistently reject"],
  "preferred_keywords": ["skills/technologies/terms that appear in positive jobs"],
  "avoided_keywords": ["terms that appear in negative jobs but not positive ones"],
  "preferred_companies": ["companies they like"],
  "avoided_companies": ["companies they skip"],
  "preferred_locations": ["locations they prefer"],
  "accepts_remote": true,
  "learned_summary": "A specific paragraph summarizing what this user actually wants based on their actions. Be concrete about role types, technologies, seniority, industries, and location preferences observed."
}

Rules:
- Only include patterns repeated across multiple signals
- If fewer than 5 total signals, note preferences are still forming
- Be conservative — don't over-generalize from one or two data points
- The learned_summary should read like advice to a recruiter: "This candidate wants X and avoids Y"`;

interface FeedbackRow {
  signal_type: string;
  metadata: {
    title?: string;
    company?: string;
    location?: string;
    is_remote?: boolean;
    relevance_score?: number;
    keywords?: string[];
  };
}

interface SynthesisResult {
  preferred_titles: string[];
  avoided_titles: string[];
  preferred_keywords: string[];
  avoided_keywords: string[];
  preferred_companies: string[];
  avoided_companies: string[];
  preferred_locations: string[];
  accepts_remote: boolean;
  learned_summary: string;
}

/**
 * Check if preference recomputation is needed based on new feedback count and time elapsed.
 */
async function shouldRecompute(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const [feedbackCount, prefs] = await Promise.all([
    supabase
      .from("job_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("user_preferences")
      .select("feedback_count_at_last_compute, last_computed_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const totalFeedback = feedbackCount.count ?? 0;
  if (totalFeedback === 0) return false;

  // No preferences yet — always compute
  if (!prefs.data) return true;

  const lastCount = prefs.data.feedback_count_at_last_compute ?? 0;
  const newSignals = totalFeedback - lastCount;

  // Enough new signals?
  if (newSignals >= RECOMPUTE_THRESHOLD) return true;

  // Enough time elapsed?
  if (prefs.data.last_computed_at) {
    const hoursSince =
      (Date.now() - new Date(prefs.data.last_computed_at).getTime()) /
      (1000 * 60 * 60);
    if (hoursSince >= RECOMPUTE_HOURS && newSignals > 0) return true;
  }

  return false;
}

/**
 * Recompute user preferences from job feedback signals using Claude.
 * Only runs if enough new feedback has accumulated (lazy recomputation).
 */
export async function recomputePreferences(
  supabase: SupabaseClient,
  userId: string,
  force = false
): Promise<{ recomputed: boolean; summary?: string }> {
  if (!force) {
    const needed = await shouldRecompute(supabase, userId);
    if (!needed) return { recomputed: false };
  }

  // Fetch all feedback with job metadata
  const { data: feedback, error } = await supabase
    .from("job_feedback")
    .select("signal_type, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !feedback || feedback.length === 0) {
    return { recomputed: false };
  }

  const rows = feedback as FeedbackRow[];

  // Group by signal type
  const positive = rows.filter((r) =>
    ["applied", "saved", "queued"].includes(r.signal_type)
  );
  const negative = rows.filter((r) =>
    ["dismissed", "deleted"].includes(r.signal_type)
  );

  const formatJobs = (items: FeedbackRow[]) =>
    items
      .map(
        (r) =>
          `- ${r.metadata?.title || "Unknown"} at ${r.metadata?.company || "Unknown"} (${r.metadata?.location || "Unknown"}, score: ${r.metadata?.relevance_score ?? "N/A"})`
      )
      .join("\n");

  const userMessage = `POSITIVE signals (${positive.length} jobs the user applied to, saved, or queued):
${positive.length > 0 ? formatJobs(positive) : "(none yet)"}

NEGATIVE signals (${negative.length} jobs the user dismissed or deleted):
${negative.length > 0 ? formatJobs(negative) : "(none yet)"}

Total feedback signals: ${rows.length}`;

  // Call Claude to synthesize
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYNTHESIS_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const responseText =
    response.content?.[0]?.type === "text" ? response.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[PreferenceLearner] Failed to parse Claude response");
    return { recomputed: false };
  }

  let result: SynthesisResult;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch {
    console.error("[PreferenceLearner] Invalid JSON from Claude");
    return { recomputed: false };
  }

  // Upsert into user_preferences
  const { error: upsertError } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        preferred_titles: result.preferred_titles || [],
        avoided_titles: result.avoided_titles || [],
        preferred_keywords: result.preferred_keywords || [],
        avoided_keywords: result.avoided_keywords || [],
        preferred_companies: result.preferred_companies || [],
        avoided_companies: result.avoided_companies || [],
        preferred_locations: result.preferred_locations || [],
        accepts_remote: result.accepts_remote ?? true,
        learned_summary: result.learned_summary || "",
        total_applied: positive.length,
        total_dismissed: negative.length,
        feedback_count_at_last_compute: rows.length,
        last_computed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    console.error("[PreferenceLearner] Failed to save preferences:", upsertError);
    return { recomputed: false };
  }

  console.log(
    `[PreferenceLearner] Recomputed preferences from ${rows.length} signals (${positive.length} positive, ${negative.length} negative)`
  );

  return { recomputed: true, summary: result.learned_summary };
}
