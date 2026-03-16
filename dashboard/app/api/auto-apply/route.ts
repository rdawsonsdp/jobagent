import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

const execAsync = promisify(exec);

const CRAWLER_DIR = path.resolve(process.cwd(), "..", "crawler");
const APPLY_SCRIPT = path.join(CRAWLER_DIR, "apply_now.py");

const runningProcesses = new Map<
  string,
  { pid: number; startedAt: string; action: string; detail: string }
>();

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserId();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Missing required field: action" },
        { status: 400 }
      );
    }

    switch (action) {
      case "apply":
        return handleApply(body, auth.userId);
      case "queue-jobs":
        return handleQueueJobs(body, auth.userId);
      case "process-queue":
        return handleProcessQueue(body, auth.userId);
      case "login":
        return handleLogin(body, auth.userId);
      case "check-session":
        return handleCheckSession(body);
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Auto-apply API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const processes = Array.from(runningProcesses.entries()).map(
      ([id, info]) => ({ id, ...info })
    );

    const sessions: Record<string, unknown> = {};
    for (const platform of ["linkedin", "indeed"]) {
      try {
        const { stdout } = await execAsync(
          `python3 "${APPLY_SCRIPT}" --check-session ${platform}`,
          { cwd: CRAWLER_DIR, timeout: 10000 }
        );
        sessions[platform] = JSON.parse(stdout.trim());
      } catch {
        sessions[platform] = { valid: false, last_updated: null, platform };
      }
    }

    return NextResponse.json({ running: processes, sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Auto-apply status error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleApply(
  body: { itemId?: string; dryRun?: boolean },
  userId: string
): Promise<NextResponse> {
  const { itemId, dryRun } = body;

  if (!itemId) {
    return NextResponse.json(
      { error: "Missing required field: itemId" },
      { status: 400 }
    );
  }

  const supabase = await createServiceRoleClient();

  const { data: item, error: fetchError } = await supabase
    .from("auto_apply_queue")
    .select("id, status, job_id, jobs(title, company)")
    .eq("id", itemId)
    .single();

  if (fetchError || !item) {
    return NextResponse.json(
      { error: `Queue item not found: ${itemId}` },
      { status: 404 }
    );
  }

  if (item.status === "pending_review") {
    const { error: updateError } = await supabase
      .from("auto_apply_queue")
      .update({ status: "approved", submitted_at: new Date().toISOString() })
      .eq("id", itemId);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update queue item status" },
        { status: 500 }
      );
    }
  }

  const args = ["apply_now.py", "--item-id", itemId, "--user-id", userId];
  if (dryRun) args.push("--dry-run");

  const processId = `apply_${itemId}`;

  try {
    const child = spawn("python3", args, {
      cwd: CRAWLER_DIR,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const jobInfo = item.jobs as { title?: string; company?: string } | null;

    runningProcesses.set(processId, {
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      action: "apply",
      detail: `${jobInfo?.title ?? "Unknown"} at ${jobInfo?.company ?? "Unknown"}`,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    child.on("close", async (code) => {
      runningProcesses.delete(processId);
      const supa = await createServiceRoleClient();
      if (code === 0) {
        // Record positive feedback signal for successful auto-apply
        const jobId = item.job_id as string;
        if (jobId) {
          const { data: job } = await supa
            .from("jobs")
            .select("title, company, keywords, relevance_score, location, is_remote")
            .eq("id", jobId)
            .single();
          await supa.from("job_feedback").upsert(
            {
              user_id: userId,
              job_id: jobId,
              signal_type: "applied",
              metadata: job || {},
            },
            { onConflict: "user_id,job_id,signal_type" }
          );
        }
      } else {
        console.error(`Apply script exited with code ${code}. stderr: ${stderr}`);
        await supa
          .from("auto_apply_queue")
          .update({
            status: "failed",
            error_message: stderr.slice(0, 500) || `Process exited with code ${code}`,
          })
          .eq("id", itemId);
      }
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message: "Application process started",
      processId,
      itemId,
      jobTitle: jobInfo?.title,
      company: jobInfo?.company,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to start apply process: ${message}` },
      { status: 500 }
    );
  }
}

async function handleLogin(
  body: { platform?: string },
  userId: string
): Promise<NextResponse> {
  const { platform } = body;

  if (!platform || !["linkedin", "indeed"].includes(platform)) {
    return NextResponse.json(
      { error: "platform must be 'linkedin' or 'indeed'" },
      { status: 400 }
    );
  }

  const processId = `login_${platform}`;
  if (runningProcesses.has(processId)) {
    return NextResponse.json(
      { error: `Login process already running for ${platform}` },
      { status: 409 }
    );
  }

  try {
    const child = spawn(
      "python3",
      ["apply_now.py", "--login", platform, "--user-id", userId],
      { cwd: CRAWLER_DIR, detached: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    runningProcesses.set(processId, {
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      action: "login",
      detail: platform,
    });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("close", (code) => {
      runningProcesses.delete(processId);
      if (code !== 0) {
        console.error(`Login script for ${platform} exited with code ${code}. stderr: ${stderr}`);
      }
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message: `Login browser opening for ${platform}. Log in manually, then close the browser.`,
      processId,
      platform,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to start login process: ${message}` },
      { status: 500 }
    );
  }
}

async function handleQueueJobs(
  body: { jobIds?: string[] },
  userId: string
): Promise<NextResponse> {
  const { jobIds } = body;

  if (!jobIds || jobIds.length === 0) {
    return NextResponse.json(
      { error: "Missing required field: jobIds" },
      { status: 400 }
    );
  }

  const supabase = await createServiceRoleClient();

  const { data: existing } = await supabase
    .from("auto_apply_queue")
    .select("job_id")
    .in("job_id", jobIds)
    .in("status", ["approved", "pending_review", "submitted"]);

  const existingJobIds = new Set((existing ?? []).map((r: { job_id: string }) => r.job_id));
  const newIds = jobIds.filter((id) => !existingJobIds.has(id));

  if (newIds.length === 0) {
    return NextResponse.json({
      queued: 0,
      skipped: jobIds.length,
      message: "All selected jobs are already in the queue",
    });
  }

  const rows = newIds.map((jobId) => ({
    job_id: jobId,
    status: "approved",
    user_id: userId,
  }));

  const { error } = await supabase.from("auto_apply_queue").insert(rows);

  if (error) {
    console.error("Failed to queue jobs:", error);
    return NextResponse.json({ error: "Failed to queue jobs" }, { status: 500 });
  }

  return NextResponse.json({
    queued: newIds.length,
    skipped: jobIds.length - newIds.length,
    message: `${newIds.length} job${newIds.length !== 1 ? "s" : ""} queued for auto-apply`,
  });
}

async function handleProcessQueue(
  body: { dryRun?: boolean },
  userId: string
): Promise<NextResponse> {
  const { dryRun } = body;
  const processId = "process_queue";

  if (runningProcesses.has(processId)) {
    return NextResponse.json(
      { error: "Queue processing is already running" },
      { status: 409 }
    );
  }

  const args = ["apply_now.py", "--process-queue", "--user-id", userId];
  if (dryRun) args.push("--dry-run");

  try {
    const child = spawn("python3", args, {
      cwd: CRAWLER_DIR,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    runningProcesses.set(processId, {
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      action: "process-queue",
      detail: dryRun ? "dry run" : "live",
    });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("close", (code) => {
      runningProcesses.delete(processId);
      if (code !== 0) {
        console.error(`Queue processing exited with code ${code}. stderr: ${stderr}`);
      }
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message: "Auto-apply queue processing started",
      processId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to start queue processing: ${message}` },
      { status: 500 }
    );
  }
}

async function handleCheckSession(body: { platform?: string }): Promise<NextResponse> {
  const { platform } = body;

  if (!platform || !["linkedin", "indeed"].includes(platform)) {
    return NextResponse.json(
      { error: "platform must be 'linkedin' or 'indeed'" },
      { status: 400 }
    );
  }

  try {
    const { stdout } = await execAsync(
      `python3 "${APPLY_SCRIPT}" --check-session ${platform}`,
      { cwd: CRAWLER_DIR, timeout: 10000 }
    );
    return NextResponse.json(JSON.parse(stdout.trim()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { valid: false, last_updated: null, platform, error: message },
      { status: 200 }
    );
  }
}
