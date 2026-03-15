import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Load user context (resume, search profile, location) for AI prompts.
 * Returns a formatted string suitable for system prompt injection.
 */
export async function loadUserContext(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const [resumeRes, profileRes, prefsRes] = await Promise.all([
    supabase
      .from("resumes")
      .select("raw_text, parsed_data, skills, target_titles")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("search_profiles")
      .select("job_titles, keywords, locations, remote_only")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_profile")
      .select("city, state, country")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  const contextParts: string[] = [];

  if (resumeRes.data) {
    const r = resumeRes.data;
    if (r.parsed_data) {
      const pd = r.parsed_data as Record<string, unknown>;
      contextParts.push(`Resume summary: ${pd.summary || "N/A"}`);
      contextParts.push(`Skills: ${(pd.skills as string[])?.join(", ") || (r.skills as string[])?.join(", ") || "N/A"}`);
      contextParts.push(`Target titles: ${(pd.target_titles as string[])?.join(", ") || (r.target_titles as string[])?.join(", ") || "N/A"}`);
      contextParts.push(`Years experience: ${pd.years_of_experience || "N/A"}`);
    } else if (r.raw_text) {
      contextParts.push(`Resume text (first 2000 chars): ${(r.raw_text as string).substring(0, 2000)}`);
    }
  }

  if (profileRes.data) {
    const p = profileRes.data;
    contextParts.push(`Search profile - Titles: ${(p.job_titles as string[])?.join(", ") || "N/A"}`);
    contextParts.push(`Search keywords: ${(p.keywords as string[])?.join(", ") || "N/A"}`);
    contextParts.push(`Preferred locations: ${(p.locations as string[])?.join(", ") || "N/A"}`);
    contextParts.push(`Remote only: ${p.remote_only ? "Yes" : "No"}`);
  }

  if (prefsRes.data) {
    const u = prefsRes.data;
    contextParts.push(`Location: ${[u.city, u.state, u.country].filter(Boolean).join(", ")}`);
  }

  if (contextParts.length === 0) return "";

  return `\n\nUSER CONTEXT (from their resume and profile):\n${contextParts.join("\n")}`;
}
