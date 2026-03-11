import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { createServiceRoleClient } from "@/lib/supabase/server";

const execAsync = promisify(exec);

// Path to the Python CLI script in the crawler directory
const CRAWLER_DIR = path.resolve(
  process.cwd(),
  "..",
  "crawler"
);
const APPLY_SCRIPT = path.join(CRAWLER_DIR, "apply_now.py");

// Track running processes so GET can report status
const runningProcesses = new Map<
  string,
  { pid: number; startedAt: string; action: string; detail: string }
>();

/**
 * POST /api/auto-apply
 *
 * Body variants:
 *   { action: "apply", itemId: string }          - Apply to a specific queue item
 *   { action: "login", platform: "linkedin" | "indeed" }  - Open browser for login
 *   { action: "check-session", platform: "linkedin" | "indeed" } - Check session status
 */
export async function POST(request: NextRequest) {
  try {
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
        return handleApply(body);
      case "queue-jobs":
        return handleQueueJobs(body);
      case "process-queue":
        return handleProcessQueue(body);
      case "login":
        return handleLogin(body);
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

/**
 * GET /api/auto-apply
 *
 * Returns the status of any running apply/login processes,
 * plus session validity info.
 */
export async function GET() {
  try {
    const processes = Array.from(runningProcesses.entries()).map(
      ([id, info]) => ({
        id,
        ...info,
      })
    );

    // Check session status for both platforms
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

    return NextResponse.json({
      running: processes,
      sessions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Auto-apply status error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// Action handlers
// ------------------------------------------------------------------

async function handleApply(body: {
  itemId?: string;
  dryRun?: boolean;
}): Promise<NextResponse> {
  const { itemId, dryRun } = body;

  if (!itemId) {
    return NextResponse.json(
      { error: "Missing required field: itemId" },
      { status: 400 }
    );
  }

  // First update the queue item status to "approved" in Supabase
  // so the crawler knows it should be processed
  const supabase = await createServiceRoleClient();

  // Verify the item exists
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

  // Update status to "approved" if still pending
  if (item.status === "pending_review") {
    const { error: updateError } = await supabase
      .from("auto_apply_queue")
      .update({
        status: "approved",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    if (updateError) {
      console.error("Failed to update queue item status:", updateError);
      return NextResponse.json(
        { error: "Failed to update queue item status" },
        { status: 500 }
      );
    }
  }

  // Spawn the Python apply script in the background
  const args = ["apply_now.py", "--item-id", itemId];
  if (dryRun) {
    args.push("--dry-run");
  }

  const processId = `apply_${itemId}`;

  try {
    const child = spawn("python3", args, {
      cwd: CRAWLER_DIR,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Type assertion for job info
    const jobInfo = item.jobs as { title?: string; company?: string } | null;

    runningProcesses.set(processId, {
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      action: "apply",
      detail: `${jobInfo?.title ?? "Unknown"} at ${jobInfo?.company ?? "Unknown"}`,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", async (code) => {
      runningProcesses.delete(processId);

      if (code !== 0) {
        console.error(
          `Apply script exited with code ${code}. stderr: ${stderr}`
        );
        // Update queue item with error info
        const supa = await createServiceRoleClient();
        await supa
          .from("auto_apply_queue")
          .update({
            status: "failed",
            error_message: stderr.slice(0, 500) || `Process exited with code ${code}`,
          })
          .eq("id", itemId);
      } else {
        console.log(`Apply script completed for item ${itemId}: ${stdout}`);
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
    console.error("Failed to spawn apply process:", message);
    return NextResponse.json(
      { error: `Failed to start apply process: ${message}` },
      { status: 500 }
    );
  }
}

async function handleLogin(body: {
  platform?: string;
}): Promise<NextResponse> {
  const { platform } = body;

  if (!platform || !["linkedin", "indeed"].includes(platform)) {
    return NextResponse.json(
      { error: "platform must be 'linkedin' or 'indeed'" },
      { status: 400 }
    );
  }

  const processId = `login_${platform}`;

  // Check if a login process is already running for this platform
  if (runningProcesses.has(processId)) {
    return NextResponse.json(
      { error: `Login process already running for ${platform}` },
      { status: 409 }
    );
  }

  try {
    const child = spawn(
      "python3",
      ["apply_now.py", "--login", platform],
      {
        cwd: CRAWLER_DIR,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    runningProcesses.set(processId, {
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      action: "login",
      detail: platform,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      runningProcesses.delete(processId);
      if (code !== 0) {
        console.error(
          `Login script for ${platform} exited with code ${code}. stderr: ${stderr}`
        );
      } else {
        console.log(
          `Login script for ${platform} completed: ${stdout}`
        );
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
    console.error("Failed to spawn login process:", message);
    return NextResponse.json(
      { error: `Failed to start login process: ${message}` },
      { status: 500 }
    );
  }
}

async function handleQueueJobs(body: {
  jobIds?: string[];
}): Promise<NextResponse> {
  const { jobIds } = body;

  if (!jobIds || jobIds.length === 0) {
    return NextResponse.json(
      { error: "Missing required field: jobIds" },
      { status: 400 }
    );
  }

  const supabase = await createServiceRoleClient();

  // Build queue rows — skip jobs already in queue
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
  }));

  const { error } = await supabase.from("auto_apply_queue").insert(rows);

  if (error) {
    console.error("Failed to queue jobs:", error);
    return NextResponse.json(
      { error: "Failed to queue jobs" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    queued: newIds.length,
    skipped: jobIds.length - newIds.length,
    message: `${newIds.length} job${newIds.length !== 1 ? "s" : ""} queued for auto-apply`,
  });
}

async function handleProcessQueue(body: {
  dryRun?: boolean;
}): Promise<NextResponse> {
  const { dryRun } = body;

  const processId = "process_queue";

  if (runningProcesses.has(processId)) {
    return NextResponse.json(
      { error: "Queue processing is already running" },
      { status: 409 }
    );
  }

  const args = ["apply_now.py", "--process-queue"];
  if (dryRun) {
    args.push("--dry-run");
  }

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

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      runningProcesses.delete(processId);
      if (code !== 0) {
        console.error(
          `Queue processing exited with code ${code}. stderr: ${stderr}`
        );
      } else {
        console.log(`Queue processing completed: ${stdout}`);
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

async function handleCheckSession(body: {
  platform?: string;
}): Promise<NextResponse> {
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

    const result = JSON.parse(stdout.trim());
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Session check error:", message);
    return NextResponse.json(
      { valid: false, last_updated: null, platform, error: message },
      { status: 200 }
    );
  }
}
