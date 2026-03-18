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
    .from("bakery_email_categories")
    .select("*")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ categories: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient();
  const body = await request.json();

  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("bakery_email_categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ category: data });
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient();
  const body = await request.json();

  const { data, error } = await supabase
    .from("bakery_email_categories")
    .insert(body)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ category: data });
}
