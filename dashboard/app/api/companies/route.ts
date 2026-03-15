import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";
import { spawn } from "child_process";
import path from "path";

const CRAWLER_DIR = path.resolve(process.cwd(), "..", "crawler");

/**
 * GET /api/companies
 * Get all target companies for the authenticated user.
 */
export async function GET() {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from("target_companies")
      .select("*")
      .eq("user_id", auth.userId)
      .order("priority", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ companies: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/companies
 * Actions: discover, add, update, toggle
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { action } = body;

    const supabase = await createServiceRoleClient();

    switch (action) {
      case "discover": {
        // Trigger AI company discovery via Python script
        const tier = body.tier || "all";
        const maxCompanies = body.maxCompanies || 50;

        const child = spawn(
          "python3",
          [
            "-c",
            `
import sys
sys.path.insert(0, '.')
from jobcrawler.ai.company_discoverer import run_company_discovery
import json
results = run_company_discovery("${auth.userId}", tier="${tier}", max_companies=${maxCompanies})
print(json.dumps({"discovered": len(results)}))
            `.trim(),
          ],
          {
            cwd: CRAWLER_DIR,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, PATH: process.env.PATH },
          }
        );

        child.unref();

        return NextResponse.json({
          success: true,
          message: "Company discovery started. Refresh in a moment to see results.",
        });
      }

      case "add": {
        const { name, industry, careersUrl, atsType, location, distanceTier } = body;

        if (!name) {
          return NextResponse.json(
            { error: "Company name is required" },
            { status: 400 }
          );
        }

        const { data, error } = await supabase
          .from("target_companies")
          .upsert(
            {
              user_id: auth.userId,
              name,
              industry: industry || null,
              careers_url: careersUrl || null,
              ats_type: atsType || null,
              location: location || null,
              distance_tier: distanceTier || "national",
              discovery_source: "user_added",
              priority: 7,
              enabled: true,
            },
            { onConflict: "user_id,name" }
          )
          .select()
          .single();

        if (error) throw error;

        return NextResponse.json({ company: data });
      }

      case "toggle": {
        const { companyId, enabled } = body;

        if (!companyId) {
          return NextResponse.json(
            { error: "companyId is required" },
            { status: 400 }
          );
        }

        const { error } = await supabase
          .from("target_companies")
          .update({ enabled: !!enabled })
          .eq("id", companyId)
          .eq("user_id", auth.userId);

        if (error) throw error;

        return NextResponse.json({ success: true });
      }

      case "watch": {
        const { companyId: wid, watched } = body;

        if (!wid) {
          return NextResponse.json(
            { error: "companyId is required" },
            { status: 400 }
          );
        }

        const { error: watchErr } = await supabase
          .from("target_companies")
          .update({ watched: !!watched })
          .eq("id", wid)
          .eq("user_id", auth.userId);

        if (watchErr) throw watchErr;

        return NextResponse.json({ success: true });
      }

      case "update-priority": {
        const { companyId: cid, priority } = body;

        if (!cid || priority == null) {
          return NextResponse.json(
            { error: "companyId and priority are required" },
            { status: 400 }
          );
        }

        const { error } = await supabase
          .from("target_companies")
          .update({ priority: Math.min(10, Math.max(1, priority)) })
          .eq("id", cid)
          .eq("user_id", auth.userId);

        if (error) throw error;

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/companies
 * Delete a target company.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { companyId } = body;

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const supabase = await createServiceRoleClient();
    const { error } = await supabase
      .from("target_companies")
      .delete()
      .eq("id", companyId)
      .eq("user_id", auth.userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
