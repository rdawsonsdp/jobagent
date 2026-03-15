import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function computeNextRun(
  daysOfWeek: number[],
  hour: number,
  minute: number,
  timezone: string
): string {
  const now = new Date();
  // Simple next-run calculation: find the next matching day/time
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now.getTime() + offset * 86400000);
    const dayOfWeek = candidate.getDay();
    if (daysOfWeek.includes(dayOfWeek)) {
      candidate.setHours(hour, minute, 0, 0);
      if (candidate > now) {
        return candidate.toISOString();
      }
    }
  }
  return new Date(now.getTime() + 86400000).toISOString();
}

/**
 * GET /api/schedule
 * Get agent schedules for the authenticated user.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("agent_schedules")
      .select("*")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ schedules: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/schedule
 * Create or update an agent schedule.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const {
      id,
      name = "Job Search",
      enabled = true,
      days_of_week = [1, 2, 3, 4, 5],
      hour = 8,
      minute = 0,
      timezone = "America/Chicago",
      budget_minutes = 30,
      dry_run = true,
    } = body;

    const supabase = await createServiceRoleClient();

    const nextRun = enabled
      ? computeNextRun(days_of_week, hour, minute, timezone)
      : null;

    if (id) {
      // Update existing
      const { data, error } = await supabase
        .from("agent_schedules")
        .update({
          name,
          enabled,
          days_of_week,
          hour,
          minute,
          timezone,
          budget_minutes,
          dry_run,
          next_run_at: nextRun,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", auth.userId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ schedule: data });
    } else {
      // Create new
      const { data, error } = await supabase
        .from("agent_schedules")
        .insert({
          user_id: auth.userId,
          name,
          enabled,
          days_of_week,
          hour,
          minute,
          timezone,
          budget_minutes,
          dry_run,
          next_run_at: nextRun,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ schedule: data });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/schedule
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { scheduleId } = body;

    if (!scheduleId) {
      return NextResponse.json({ error: "scheduleId required" }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();
    const { error } = await supabase
      .from("agent_schedules")
      .delete()
      .eq("id", scheduleId)
      .eq("user_id", auth.userId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
