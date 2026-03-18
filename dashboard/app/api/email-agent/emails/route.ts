import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const supabase = getServiceClient();
  const { searchParams } = new URL(request.url);

  const direction = searchParams.get("direction");
  const category = searchParams.get("category");
  const processed = searchParams.get("processed");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  let query = supabase
    .from("bakery_emails")
    .select("*, bakery_email_actions(*)", { count: "exact" })
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (direction) query = query.eq("direction", direction);
  if (processed === "true") query = query.eq("is_processed", true);
  if (processed === "false") query = query.eq("is_processed", false);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ emails: data, total: count });
}
