import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

/**
 * GET /api/suggestions
 * Get pending search suggestions for the authenticated user.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("search_suggestions")
      .select("*")
      .eq("user_id", auth.userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ suggestions: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/suggestions
 * Accept or dismiss a suggestion.
 * Body: { suggestionId: string, action: 'accepted' | 'dismissed' }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { suggestionId, action: suggestionAction } = body;

    if (!suggestionId || !["accepted", "dismissed"].includes(suggestionAction)) {
      return NextResponse.json(
        { error: "suggestionId and action ('accepted' or 'dismissed') are required" },
        { status: 400 }
      );
    }

    const supabase = await createServiceRoleClient();

    // Update suggestion status
    const { data: suggestion, error: updateError } = await supabase
      .from("search_suggestions")
      .update({ status: suggestionAction })
      .eq("id", suggestionId)
      .eq("user_id", auth.userId)
      .select()
      .single();

    if (updateError) throw updateError;

    // If accepted, apply the suggestion to the search profile
    if (suggestionAction === "accepted" && suggestion) {
      await applySuggestion(supabase, auth.userId, suggestion);
    }

    return NextResponse.json({ success: true, suggestion });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function applySuggestion(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  userId: string,
  suggestion: Record<string, unknown>
) {
  const { suggestion_type, field, value } = suggestion as {
    suggestion_type: string;
    field: string;
    value: string;
  };

  // Get the first active search profile for the user
  const { data: profiles } = await supabase
    .from("search_profiles")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1);

  if (!profiles || profiles.length === 0) return;

  const profile = profiles[0];
  const profileId = profile.id;

  switch (suggestion_type) {
    case "add_keyword": {
      const keywords = [...(profile.keywords || []), value];
      await supabase
        .from("search_profiles")
        .update({ keywords })
        .eq("id", profileId);
      break;
    }
    case "add_title": {
      const titles = [...(profile.job_titles || []), value];
      await supabase
        .from("search_profiles")
        .update({ job_titles: titles })
        .eq("id", profileId);
      break;
    }
    case "add_negative_keyword": {
      const negKw = [...(profile.negative_keywords || []), value];
      await supabase
        .from("search_profiles")
        .update({ negative_keywords: negKw })
        .eq("id", profileId);
      break;
    }
    case "raise_min_score": {
      const newScore = parseInt(value, 10);
      if (!isNaN(newScore)) {
        await supabase
          .from("search_profiles")
          .update({ min_relevance_score: newScore })
          .eq("id", profileId);
      }
      break;
    }
  }
}
