import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

/**
 * POST /api/feedback
 * Record a job feedback signal.
 * Body: { jobId: string, signalType: 'applied' | 'deleted' | 'saved' | 'dismissed', metadata?: object }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { jobId, signalType, metadata } = body;

    if (!jobId || !signalType) {
      return NextResponse.json(
        { error: "jobId and signalType are required" },
        { status: 400 }
      );
    }

    const validSignals = ["applied", "deleted", "saved", "dismissed"];
    if (!validSignals.includes(signalType)) {
      return NextResponse.json(
        { error: `signalType must be one of: ${validSignals.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = await createServiceRoleClient();

    // Optionally snapshot job data for metadata
    let feedbackMetadata = metadata || {};
    if (!metadata) {
      const { data: job } = await supabase
        .from("jobs")
        .select("title, company, keywords, relevance_score, location, is_remote")
        .eq("id", jobId)
        .single();

      if (job) {
        feedbackMetadata = job;
      }
    }

    const { data, error } = await supabase
      .from("job_feedback")
      .upsert(
        {
          user_id: auth.userId,
          job_id: jobId,
          signal_type: signalType,
          metadata: feedbackMetadata,
        },
        { onConflict: "user_id,job_id,signal_type" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ feedback: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/feedback
 * Get feedback stats for the authenticated user.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from("job_feedback")
      .select("signal_type")
      .eq("user_id", auth.userId);

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.signal_type] = (counts[row.signal_type] || 0) + 1;
    }

    return NextResponse.json({ counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
