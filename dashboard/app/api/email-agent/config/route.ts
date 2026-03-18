import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("bakery_config")
    .select("*")
    .order("key");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Transform into key-value object
  const config: Record<string, unknown> = {};
  for (const row of data || []) {
    config[row.key] = row.value;
  }

  return NextResponse.json({ config });
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient();
  const body = await request.json();

  const updates = Object.entries(body).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
    updated_at: new Date().toISOString(),
  }));

  for (const update of updates) {
    const { error } = await supabase
      .from("bakery_config")
      .upsert(update, { onConflict: "key" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
