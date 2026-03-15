import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

/**
 * GET /api/profile-answers
 * Returns all profile answers for the authenticated user.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("profile_answers")
      .select("*")
      .eq("user_id", auth.userId)
      .order("category")
      .order("field_label");

    if (error) throw error;

    return NextResponse.json({ answers: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/profile-answers
 * Upsert a profile answer for the authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { field_key, field_label, value, category } = body;

    if (!field_key || !value) {
      return NextResponse.json(
        { error: "field_key and value are required" },
        { status: 400 }
      );
    }

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("profile_answers")
      .upsert(
        {
          user_id: auth.userId,
          field_key,
          field_label: field_label || field_key,
          value,
          category: category || "general",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,field_key" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ answer: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/profile-answers
 * Delete a profile answer for the authenticated user.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { field_key } = body;

    if (!field_key) {
      return NextResponse.json(
        { error: "field_key is required" },
        { status: 400 }
      );
    }

    const supabase = await createServiceRoleClient();
    const { error } = await supabase
      .from("profile_answers")
      .delete()
      .eq("field_key", field_key)
      .eq("user_id", auth.userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
