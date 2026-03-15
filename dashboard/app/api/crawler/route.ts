import { NextRequest, NextResponse } from "next/server";
import { exec, execSync, spawn } from "child_process";
import path from "path";
import { getAuthUserId } from "@/lib/auth";

const CRAWLER_DIR = path.resolve(process.cwd(), "..", "crawler");
const PYTHON = path.join(CRAWLER_DIR, ".venv", "bin", "python");
const ORCHESTRATOR = path.join(CRAWLER_DIR, "crawl_orchestrator.py");

let crawlerProcess: ReturnType<typeof spawn> | null = null;
let crawlerPid: number | null = null;

function isCrawlerRunning(): boolean {
  try {
    const result = execSync(
      `ps aux | grep crawl_orchestrator | grep -v grep | awk '{print $2}'`,
      { encoding: "utf-8" }
    ).trim();
    if (result) {
      crawlerPid = parseInt(result.split("\n")[0], 10);
      return true;
    }
  } catch {
    // no process found
  }
  crawlerPid = null;
  return false;
}

export async function GET() {
  const running = isCrawlerRunning();
  return NextResponse.json({ running, pid: crawlerPid });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthUserId();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const action = body.action as string;

  if (action === "start") {
    if (isCrawlerRunning()) {
      return NextResponse.json(
        { error: "Crawler is already running", pid: crawlerPid },
        { status: 409 }
      );
    }

    const budget = body.budget ?? 30;
    const proc = spawn(
      PYTHON,
      [ORCHESTRATOR, "--budget", String(budget), "--user-id", auth.userId],
      {
        cwd: CRAWLER_DIR,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PATH: process.env.PATH },
      }
    );
    proc.unref();
    crawlerProcess = proc;
    crawlerPid = proc.pid ?? null;

    return NextResponse.json({ started: true, pid: crawlerPid });
  }

  if (action === "stop") {
    if (!isCrawlerRunning()) {
      return NextResponse.json({ error: "No crawler running" }, { status: 404 });
    }

    try {
      process.kill(crawlerPid!, "SIGTERM");
      crawlerProcess = null;
      crawlerPid = null;
      return NextResponse.json({ stopped: true });
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to stop crawler" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
