import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Get actions (drafts, auto-replies, escalations)
export async function GET(request: NextRequest) {
  const supabase = getServiceClient();
  const { searchParams } = new URL(request.url);

  const status = searchParams.get("status");
  const action = searchParams.get("action");
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = supabase
    .from("bakery_email_actions")
    .select("*, bakery_emails(*)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (action) query = query.eq("action", action);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ actions: data });
}

// Update an action (approve, edit, reject a draft)
export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient();
  const body = await request.json();

  const { id, status, final_response } = body;
  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
  };

  if (final_response) update.final_response = final_response;
  if (status === "approved" && !final_response) {
    // Use draft_response as final if not edited
    const { data: existing } = await supabase
      .from("bakery_email_actions")
      .select("draft_response")
      .eq("id", id)
      .single();
    if (existing) update.final_response = existing.draft_response;
  }

  const { data, error } = await supabase
    .from("bakery_email_actions")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ action: data });
}
