import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";
import { recomputePreferences } from "@/lib/preference-learner";

/**
 * POST /api/feedback/recompute
 * Force recomputation of learned preferences from feedback signals.
 */
export async function POST() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const result = await recomputePreferences(supabase, auth.userId, true);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/feedback/recompute
 * Get the current learned preferences summary.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const { data } = await supabase
      .from("user_preferences")
      .select(
        "learned_summary, preferred_titles, avoided_titles, preferred_keywords, avoided_keywords, total_applied, total_dismissed, last_computed_at, feedback_count_at_last_compute"
      )
      .eq("user_id", auth.userId)
      .maybeSingle();

    return NextResponse.json({ preferences: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
