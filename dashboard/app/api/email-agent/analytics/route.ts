import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = getServiceClient();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Parallel queries for analytics
  const [
    totalEmails,
    todayEmails,
    weekEmails,
    totalActions,
    autoReplied,
    drafted,
    escalated,
    approvedNoEdit,
    editedDrafts,
    categoryBreakdown,
  ] = await Promise.all([
    supabase.from("bakery_emails").select("id", { count: "exact", head: true }).eq("direction", "inbound"),
    supabase.from("bakery_emails").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("received_at", todayStart),
    supabase.from("bakery_emails").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("received_at", weekStart),
    supabase.from("bakery_email_actions").select("id", { count: "exact", head: true }),
    supabase.from("bakery_email_actions").select("id", { count: "exact", head: true }).eq("action", "auto_replied"),
    supabase.from("bakery_email_actions").select("id", { count: "exact", head: true }).eq("action", "drafted"),
    supabase.from("bakery_email_actions").select("id", { count: "exact", head: true }).eq("action", "escalated"),
    supabase.from("bakery_email_actions").select("id", { count: "exact", head: true }).eq("status", "sent").eq("action", "auto_replied"),
    supabase.from("bakery_email_actions").select("id", { count: "exact", head: true }).eq("status", "edited"),
    supabase.from("bakery_email_actions").select("category").not("category", "is", null),
  ]);

  // Build category counts
  const categoryCounts: Record<string, number> = {};
  for (const row of categoryBreakdown.data || []) {
    const cat = row.category as string;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const total = totalActions.count || 0;
  const autoRate = total > 0 ? ((autoReplied.count || 0) / total) * 100 : 0;
  const editRate = total > 0 ? ((editedDrafts.count || 0) / total) * 100 : 0;

  return NextResponse.json({
    overview: {
      total_emails: totalEmails.count || 0,
      today: todayEmails.count || 0,
      this_week: weekEmails.count || 0,
    },
    actions: {
      total: total,
      auto_replied: autoReplied.count || 0,
      drafted: drafted.count || 0,
      escalated: escalated.count || 0,
    },
    rates: {
      auto_reply_rate: Math.round(autoRate * 10) / 10,
      human_edit_rate: Math.round(editRate * 10) / 10,
    },
    category_breakdown: categoryCounts,
  });
}
