"use client";

import { useState, useCallback, useEffect, useRef, DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import RelevanceScore from "@/components/jobs/RelevanceScore";
import { toast } from "sonner";
import {
  MapPin,
  Loader2,
  Search,
  Play,
  LogIn,
  Shield,
  ShieldCheck,
  ScrollText,
  Trash2,
  ExternalLink,
  GripVertical,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  relevance_score: number | null;
  is_remote: boolean | null;
  url: string | null;
  posted_date: string | null;
  created_at: string | null;
}

interface QueueItem {
  id: string;
  job_id: string;
  status: string;
  notes?: string | null;
  created_at: string;
  error_message: string | null;
  job?: Job;
}

interface LogEntry {
  id: string;
  step_number: number | null;
  action: string;
  detail: string;
  level: string;
  created_at: string;
}

interface SessionInfo {
  valid: boolean;
  last_updated: string | null;
}

type ColumnId = "jobs" | "queued" | "applying" | "applied" | "failed";

const COLUMNS: { id: ColumnId; label: string; color: string; bgDrop: string }[] = [
  { id: "jobs",     label: "Jobs",     color: "border-blue-400",   bgDrop: "bg-blue-50" },
  { id: "queued",   label: "Queued",   color: "border-amber-400",  bgDrop: "bg-amber-50" },
  { id: "applying", label: "Applying", color: "border-purple-400", bgDrop: "bg-purple-50" },
  { id: "applied",  label: "Applied",  color: "border-green-400",  bgDrop: "bg-green-50" },
  { id: "failed",   label: "Failed",   color: "border-red-400",    bgDrop: "bg-red-50" },
];

// Map queue statuses to columns
function statusToColumn(status: string): ColumnId {
  switch (status) {
    case "approved":
    case "pending_review":
      return "queued";
    case "submitted":
    case "dry_run_complete":
      return "applied";
    case "failed":
    case "needs_login":
    case "needs_account":
      return "failed";
    default:
      return "queued";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({});
  const [loginPlatform, setLoginPlatform] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null);
  const [dragJobId, setDragJobId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supabase = createClient();

  // --- Data fetching ---

  const fetchJobs = useCallback(async () => {
    let query = supabase
      .from("jobs")
      .select("id, title, company, location, relevance_score, is_remote, url, posted_date, created_at")
      .eq("is_active", true)
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .limit(200);

    if (search) {
      query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%`);
    }
    if (minScore > 0) {
      query = query.gte("relevance_score", minScore);
    }

    const { data } = await query;
    if (data) setJobs(data as Job[]);
    setLoading(false);
  }, [search, minScore]);

  const fetchQueue = useCallback(async () => {
    const { data } = await supabase
      .from("auto_apply_queue")
      .select("*, job:jobs(id, title, company, location, relevance_score, is_remote, url, posted_date, created_at)")
      .order("created_at", { ascending: false });
    if (data) setQueueItems(data as QueueItem[]);
  }, []);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("auto_apply_logs")
      .select("id, step_number, action, detail, level, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setLogs(data as LogEntry[]);
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/auto-apply");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchQueue();
    fetchLogs();
    fetchSessions();

    pollRef.current = setInterval(() => {
      fetchQueue();
      fetchLogs();
    }, 4000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchJobs, fetchQueue, fetchLogs, fetchSessions]);

  // --- Queued job IDs for filtering ---
  const queuedJobIds = new Set(queueItems.map((q) => q.job_id));

  // Jobs not yet in any pipeline column
  const availableJobs = jobs.filter((j) => !queuedJobIds.has(j.id));

  // Group queue items by column
  const queueByColumn: Record<ColumnId, QueueItem[]> = {
    jobs: [],
    queued: [],
    applying: [],
    applied: [],
    failed: [],
  };
  for (const item of queueItems) {
    const col = statusToColumn(item.status);
    queueByColumn[col].push(item);
  }

  // --- Drag and drop ---

  const handleDragStart = (e: DragEvent, jobId: string) => {
    e.dataTransfer.setData("text/plain", jobId);
    setDragJobId(jobId);
  };

  const handleDragOver = (e: DragEvent, colId: ColumnId) => {
    e.preventDefault();
    setDragOverCol(colId);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleDrop = async (e: DragEvent, colId: ColumnId) => {
    e.preventDefault();
    setDragOverCol(null);
    const jobId = e.dataTransfer.getData("text/plain");
    setDragJobId(null);
    if (!jobId) return;

    if (colId === "queued") {
      // Add job to auto-apply queue
      try {
        const res = await fetch("/api/auto-apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "queue-jobs", jobIds: [jobId] }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success(data.message);
          sendFeedback(jobId, "queued");
          fetchQueue();
        } else {
          toast.error(data.error || "Failed to queue job");
        }
      } catch {
        toast.error("Failed to queue job");
      }
    } else if (colId === "applied") {
      // Record applied feedback
      sendFeedback(jobId, "applied");
    } else if (colId === "failed") {
      // Record dismissed feedback
      sendFeedback(jobId, "dismissed");
    } else if (colId === "jobs") {
      // Remove from queue (move back to jobs)
      const item = queueItems.find((q) => q.job_id === jobId);
      if (item) {
        const { error } = await supabase.from("auto_apply_queue").delete().eq("id", item.id);
        if (!error) {
          toast.success("Removed from pipeline");
          fetchQueue();
        }
      }
    }
  };

  // --- Actions ---

  const executeAutoApply = async () => {
    setExecuting(true);
    try {
      const res = await fetch("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process-queue" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Auto-apply started!");
      } else {
        toast.error(data.error || "Failed to start");
      }
    } catch {
      toast.error("Failed to start auto-apply");
    }
    setExecuting(false);
  };

  const loginToPlatform = async (platform: string) => {
    setLoginPlatform(platform);
    try {
      const res = await fetch("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", platform }),
      });
      if (res.ok) {
        toast.success(`${platform} login browser opened. Log in, then close.`);
        setTimeout(fetchSessions, 15000);
      }
    } catch { /* ignore */ }
    setLoginPlatform(null);
  };

  const sendFeedback = async (jobId: string, signalType: string) => {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, signalType }),
      });
    } catch {
      // Feedback is best-effort, don't block the UI
    }
  };

  const deleteJob = async (jobId: string) => {
    await sendFeedback(jobId, "deleted");
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    if (!error) {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  };

  const removeFromQueue = async (itemId: string) => {
    const { error } = await supabase.from("auto_apply_queue").delete().eq("id", itemId);
    if (!error) fetchQueue();
  };

  // --- Render helpers ---

  const isNewJob = (job: Job) => {
    if (!job.created_at) return false;
    const created = new Date(job.created_at).getTime();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return created > oneDayAgo;
  };

  const renderJobCard = (job: Job, inQueue?: QueueItem) => {
    const jobId = job.id;
    const isNew = isNewJob(job);
    return (
      <div
        key={jobId}
        draggable
        onDragStart={(e) => handleDragStart(e, jobId)}
        className={`group rounded-lg border bg-white p-3 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
          dragJobId === jobId ? "opacity-50" : ""
        } ${isNew ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"}`}
      >
        <div className="flex items-start gap-2">
          <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {isNew && (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-blue-500 text-white">
                    New
                  </span>
                )}
                <a
                  href={job.url || `/jobs/${jobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sm text-gray-900 hover:text-blue-600 transition-colors line-clamp-2 leading-tight"
                >
                  {job.title}
                </a>
              </div>
              {job.relevance_score != null && (
                <div className="shrink-0">
                  <RelevanceScore score={job.relevance_score} size="sm" />
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1 truncate">{job.company ?? "Unknown"}</p>
            {job.location && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {job.location}
                {job.is_remote && <span className="text-green-600 font-medium ml-1">Remote</span>}
              </p>
            )}
            {inQueue?.notes && (
              <p className="text-xs text-gray-400 mt-1 truncate italic">{inQueue.notes}</p>
            )}
            {inQueue?.error_message && (
              <p className="text-xs text-red-500 mt-1 truncate">{inQueue.error_message}</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-gray-100">
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
            </a>
          )}
          {inQueue ? (
            <button onClick={() => removeFromQueue(inQueue.id)} className="p-1 rounded hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          ) : (
            <button onClick={() => deleteJob(jobId)} className="p-1 rounded hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Loading pipeline...</span>
      </div>
    );
  }

  // Height for the board: full viewport minus top bar, log, and padding
  const boardHeight = logOpen ? "calc(100vh - 240px)" : "calc(100vh - 110px)";

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-bold text-gray-900">Job Pipeline</h1>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:bg-white"
            />
          </div>

          {/* Min score */}
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <span className="text-xs">Score</span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-16 accent-blue-600"
            />
            <span className="w-4 text-center text-xs font-medium">{minScore}</span>
          </div>

          {/* Sessions */}
          <div className="flex items-center gap-2 text-xs border-l border-gray-200 pl-3">
            {(["indeed", "linkedin"] as const).map((p) => (
              <div key={p} className="flex items-center gap-1">
                {sessions[p]?.valid ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Shield className="w-3.5 h-3.5 text-gray-400" />
                )}
                <span className={sessions[p]?.valid ? "text-green-700" : "text-gray-500"}>
                  {p === "indeed" ? "Indeed" : "LinkedIn"}
                </span>
                {!sessions[p]?.valid && (
                  <button
                    onClick={() => loginToPlatform(p)}
                    disabled={loginPlatform === p}
                    className="text-blue-600 hover:underline"
                  >
                    {loginPlatform === p ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Execute */}
          <button
            onClick={executeAutoApply}
            disabled={executing || queueByColumn.queued.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Execute ({queueByColumn.queued.length})
          </button>
        </div>
      </div>

      {/* Kanban Board — Trello-style horizontal scroll */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-3" style={{ height: boardHeight }}>
        <div className="flex gap-3 h-full" style={{ minWidth: "max-content" }}>
          {COLUMNS.map((col) => {
            const isDropTarget = dragOverCol === col.id;
            let cards: React.ReactNode[];

            if (col.id === "jobs") {
              cards = availableJobs.map((job) => renderJobCard(job));
            } else {
              cards = queueByColumn[col.id].map((item) => {
                const job = item.job as Job | undefined;
                if (!job) return null;
                return renderJobCard(job, item);
              }).filter(Boolean) as React.ReactNode[];
            }

            return (
              <div
                key={col.id}
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.id)}
                className={`shrink-0 flex flex-col rounded-xl border-t-4 ${col.color} bg-gray-50 overflow-hidden ${
                  isDropTarget ? col.bgDrop + " ring-2 ring-offset-1 ring-blue-300" : ""
                } transition-all`}
                style={{ width: "calc((100vw - 4.5rem) / 3)" }}
              >
                {/* Column header */}
                <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-700">{col.label}</h2>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {cards.length}
                  </span>
                </div>

                {/* Cards — scrollable */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.length === 0 ? (
                    <div className="text-center py-8 text-xs text-gray-400">
                      {col.id === "jobs" ? "No jobs match filters" : "Drag jobs here"}
                    </div>
                  ) : (
                    cards
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Activity Log — collapsible bottom panel */}
      <div className="shrink-0 border-t border-gray-300 bg-gray-900">
        <button
          onClick={() => setLogOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          <ScrollText className="w-3.5 h-3.5" />
          <span className="font-medium">Activity Log ({logs.length})</span>
          <span className="ml-auto">{logOpen ? "▼ collapse" : "▲ expand"}</span>
        </button>

        {logOpen && logs.length > 0 && (
          <div className="max-h-36 overflow-y-auto px-4 pb-3 font-mono text-xs space-y-0.5">
            {logs.map((log) => {
              const time = new Date(log.created_at).toLocaleTimeString("en-US", {
                hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
              });
              const levelColor =
                log.level === "error" ? "text-red-400"
                : log.level === "warn" ? "text-yellow-400"
                : log.level === "success" ? "text-green-400"
                : "text-gray-400";
              const actionColor =
                log.action === "click" ? "text-cyan-400"
                : log.action === "type" ? "text-purple-400"
                : log.action === "navigate" || log.action === "page_loaded" ? "text-blue-400"
                : log.action === "done" || log.action === "dry_run_stop" ? "text-green-400"
                : log.action === "failed" ? "text-red-400"
                : "text-gray-300";

              return (
                <div key={log.id} className="flex gap-2 leading-relaxed">
                  <span className="text-gray-500 shrink-0">{time}</span>
                  {log.step_number != null && log.step_number > 0 && (
                    <span className="text-gray-600 shrink-0">[{String(log.step_number).padStart(2, "0")}]</span>
                  )}
                  <span className={`${levelColor} shrink-0 uppercase w-7`}>
                    {log.level === "info" ? "INF" : log.level === "error" ? "ERR" : log.level === "warn" ? "WRN" : "OK "}
                  </span>
                  <span className={`${actionColor} shrink-0 w-20 truncate`}>{log.action}</span>
                  <span className="text-gray-200 break-all">{log.detail}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
