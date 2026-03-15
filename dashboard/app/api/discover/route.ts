import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a career advisor helping someone discover companies that would be a great fit for them. Your goal is to have a brief, focused conversation to understand what they're looking for, then generate a targeted list of real companies.

CONVERSATION PHASE:
Ask 3-5 focused questions (one at a time) to understand:
1. What industries/sectors excite them (or confirm from their resume)
2. Company size preference (startup vs mid-size vs enterprise)
3. Geographic preferences and remote work openness
4. Any specific companies they admire or want to work at (to understand their taste)
5. How many companies they'd like you to find (suggest a default of 25, but let them choose — e.g. 10, 25, 50, or 100)

Keep questions conversational and brief. Use what you already know from their resume/profile to make smart suggestions rather than asking obvious questions. Don't ask questions whose answers are obvious from their resume.

IMPORTANT: After gathering enough information (usually 3-5 exchanges), tell the user you're ready to generate companies and include the marker [READY_TO_DISCOVER] in your response. Do NOT generate companies during the conversation phase.

When you see [GENERATE_COMPANIES] in a user message, switch to discovery mode and output ONLY a JSON array of companies (no other text). Each company object must have:
{
  "name": "Company Name",
  "industry": "Industry",
  "careers_url": "https://...",
  "location": "City, State or Remote",
  "distance_tier": "local|regional|national|remote",
  "ats_type": "greenhouse|lever|workday|icims|null",
  "reasoning": "Why this company is a good fit"
}

Generate the number of companies the user requested (default 25 if they didn't specify). Use REAL companies with accurate career page URLs. Prioritize:
- Companies actively hiring for roles matching the user's skills
- Mix of tiers (local, regional, national, remote)
- Companies where the user's specific background is valued`;

/**
 * POST /api/discover
 * Interactive company discovery chat with Claude.
 * Streams responses back to the client.
 *
 * Body: { messages: [{role, content}], resume?: string, profile?: object }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { messages, generateCompanies } = body;

    const supabase = await createServiceRoleClient();

    // Load user context (resume + search profile)
    const [resumeRes, profileRes, prefsRes] = await Promise.all([
      supabase
        .from("resumes")
        .select("raw_text, parsed_data, skills, target_titles")
        .eq("user_id", auth.userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("search_profiles")
        .select("job_titles, keywords, locations, remote_only")
        .eq("user_id", auth.userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("user_profile")
        .select("city, state, country")
        .eq("user_id", auth.userId)
        .limit(1)
        .maybeSingle(),
    ]);

    // Build context message
    const contextParts: string[] = [];

    if (resumeRes.data) {
      const r = resumeRes.data;
      if (r.parsed_data) {
        const pd = r.parsed_data as Record<string, unknown>;
        contextParts.push(`Resume summary: ${pd.summary || "N/A"}`);
        contextParts.push(`Skills: ${(pd.skills as string[])?.join(", ") || r.skills?.join(", ") || "N/A"}`);
        contextParts.push(`Target titles: ${(pd.target_titles as string[])?.join(", ") || r.target_titles?.join(", ") || "N/A"}`);
        contextParts.push(`Years experience: ${pd.years_of_experience || "N/A"}`);
      } else if (r.raw_text) {
        contextParts.push(`Resume text (first 2000 chars): ${r.raw_text.substring(0, 2000)}`);
      }
    }

    if (profileRes.data) {
      const p = profileRes.data;
      contextParts.push(`Search profile - Titles: ${p.job_titles?.join(", ") || "N/A"}`);
      contextParts.push(`Search keywords: ${p.keywords?.join(", ") || "N/A"}`);
      contextParts.push(`Preferred locations: ${p.locations?.join(", ") || "N/A"}`);
      contextParts.push(`Remote only: ${p.remote_only ? "Yes" : "No"}`);
    }

    if (prefsRes.data) {
      const u = prefsRes.data;
      contextParts.push(`Location: ${[u.city, u.state, u.country].filter(Boolean).join(", ")}`);
    }

    const userContext = contextParts.length > 0
      ? `\n\nUSER CONTEXT (from their resume and profile):\n${contextParts.join("\n")}`
      : "";

    // Build messages for Claude
    const claudeMessages: Anthropic.MessageParam[] = [];

    // If this is the initial message, inject context
    if (messages.length === 0 || (messages.length === 1 && messages[0].role === "user")) {
      claudeMessages.push({
        role: "user",
        content: messages.length > 0
          ? messages[0].content
          : "Hi! I'd like to discover companies that would be a good fit for me.",
      });
    } else {
      for (const msg of messages) {
        claudeMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    // If ready to generate, append the trigger
    if (generateCompanies) {
      claudeMessages.push({
        role: "user",
        content: "[GENERATE_COMPANIES] Based on our conversation, generate the company list as JSON.",
      });
    }

    // Stream response
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT + userContext,
      messages: claudeMessages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Stream error" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * PUT /api/discover
 * Save discovered companies and optionally save the discovery prompt.
 * Body: { companies: [...], savePrompt?: { name, conversation, preferences, schedule } }
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { companies, savePrompt } = body;

    const supabase = await createServiceRoleClient();
    let savedCount = 0;
    let promptId: string | null = null;

    // Save companies
    if (Array.isArray(companies) && companies.length > 0) {
      const rows = companies.map((c: Record<string, unknown>) => ({
        user_id: auth.userId,
        name: c.name as string,
        industry: (c.industry as string) || null,
        careers_url: (c.careers_url as string) || null,
        ats_type: (c.ats_type as string) || null,
        location: (c.location as string) || null,
        distance_tier: (c.distance_tier as string) || "national",
        discovery_source: "claude_suggested",
        priority: 5,
        enabled: true,
      }));

      const { data, error } = await supabase
        .from("target_companies")
        .upsert(rows, { onConflict: "user_id,name" })
        .select();

      if (error) throw error;
      savedCount = data?.length || 0;
      // Career page crawling is now driven by the client with a visible activity log
    }

    // Save discovery prompt for scheduled searches
    if (savePrompt) {
      const { data: promptData, error: promptError } = await supabase
        .from("discovery_prompts")
        .insert({
          user_id: auth.userId,
          name: savePrompt.name || "My Discovery",
          conversation: savePrompt.conversation || [],
          preferences: savePrompt.preferences || {},
          schedule: savePrompt.schedule || "weekly",
          is_active: true,
        })
        .select("id")
        .single();

      if (promptError) throw promptError;
      promptId = promptData?.id || null;
    }

    return new Response(
      JSON.stringify({ saved: savedCount, promptId }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * GET /api/discover
 * Get saved discovery prompts.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("discovery_prompts")
      .select("*")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return new Response(
      JSON.stringify({ prompts: data ?? [] }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
