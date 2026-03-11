"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  Clock,
  FileText,
  Building2,
  Play,
  LogIn,
  ShieldCheck,
  ShieldAlert,
  ScrollText,
} from "lucide-react";

interface AutoApplyItem {
  id: string;
  job_id: string;
  status: string;
  cover_letter_draft: string | null;
  submitted_at: string | null;
  created_at: string;
  job?: {
    title: string;
    company: string;
    url: string | null;
  };
}

interface SessionStatus {
  valid: boolean;
  last_updated: string | null;
  platform: string;
}

interface LogEntry {
  id: string;
  queue_item_id: string | null;
  job_id: string | null;
  step_number: number | null;
  action: string;
  detail: string;
  screenshot_path: string | null;
  level: string;
  created_at: string;
}

export default function AutoApplyPage() {
  const [pendingItems, setPendingItems] = useState<AutoApplyItem[]>([]);
  const [submittedItems, setSubmittedItems] = useState<AutoApplyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editedLetters, setEditedLetters] = useState<Record<string, string>>({});
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionStatus>>({});
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("auto_apply_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setLogs(data as LogEntry[]);
  }, []);

  const fetchItems = useCallback(async () => {
    const supabase = createClient();

    const [pendingRes, submittedRes] = await Promise.all([
      supabase
        .from("auto_apply_queue")
        .select("*, job:jobs(title, company, url)")
        .eq("status", "pending_review")
        .order("created_at", { ascending: false }),
      supabase
        .from("auto_apply_queue")
        .select("*, job:jobs(title, company, url)")
        .in("status", ["submitted", "approved", "rejected", "failed", "dry_run_complete"])
        .order("submitted_at", { ascending: false })
        .limit(50),
    ]);

    if (pendingRes.error) {
      toast.error("Failed to load pending items");
      console.error(pendingRes.error);
    } else {
      setPendingItems(pendingRes.data as AutoApplyItem[]);
    }

    if (submittedRes.error) {
      console.error(submittedRes.error);
    } else {
      setSubmittedItems(submittedRes.data as AutoApplyItem[]);
    }

    setLoading(false);
  }, []);

  const fetchSessionStatus = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/auto-apply");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? {});
      }
    } catch (err) {
      console.error("Failed to fetch session status:", err);
    }
    setSessionsLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
    fetchSessionStatus();
    fetchLogs();

    // Poll logs every 3 seconds
    logPollRef.current = setInterval(() => {
      fetchLogs();
      fetchItems();
    }, 3000);

    return () => {
      if (logPollRef.current) clearInterval(logPollRef.current);
    };
  }, [fetchItems, fetchSessionStatus, fetchLogs]);

  const handleApprove = async (item: AutoApplyItem) => {
    setProcessingIds((prev) => new Set(prev).add(item.id));
    const supabase = createClient();

    const coverLetter = editedLetters[item.id] ?? item.cover_letter_draft;

    const { error } = await supabase
      .from("auto_apply_queue")
      .update({
        status: "approved",
        cover_letter_draft: coverLetter,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (error) {
      toast.error("Failed to approve application");
    } else {
      toast.success(`Approved application for ${item.job?.title ?? "job"}`);
      fetchItems();
    }
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  const handleReject = async (item: AutoApplyItem) => {
    setProcessingIds((prev) => new Set(prev).add(item.id));
    const supabase = createClient();

    const { error } = await supabase
      .from("auto_apply_queue")
      .update({ status: "rejected" })
      .eq("id", item.id);

    if (error) {
      toast.error("Failed to reject application");
    } else {
      toast.success("Application rejected");
      fetchItems();
    }
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  const handleApplyNow = async (item: AutoApplyItem) => {
    setApplyingIds((prev) => new Set(prev).add(item.id));

    try {
      const res = await fetch("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          itemId: item.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to start application");
      } else {
        toast.success(
          `Application process started for ${item.job?.title ?? "job"}`
        );
        // Refresh the list after a short delay to show updated status
        setTimeout(() => fetchItems(), 2000);
      }
    } catch (err) {
      toast.error("Failed to trigger apply");
      console.error(err);
    }

    setApplyingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  const handleLogin = async (platform: "linkedin" | "indeed") => {
    setLoginLoading(platform);

    try {
      const res = await fetch("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          platform,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? `Failed to open ${platform} login`);
      } else {
        toast.success(
          `Browser opening for ${platform} login. Complete the login in the browser window.`
        );
        // Poll for session status update
        setTimeout(() => fetchSessionStatus(), 10000);
      }
    } catch (err) {
      toast.error(`Failed to open ${platform} login`);
      console.error(err);
    }

    setLoginLoading(null);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
      approved: {
        bg: "bg-green-50",
        text: "text-green-700",
        icon: <CheckCircle className="w-3.5 h-3.5" />,
      },
      submitted: {
        bg: "bg-blue-50",
        text: "text-blue-700",
        icon: <Send className="w-3.5 h-3.5" />,
      },
      rejected: {
        bg: "bg-red-50",
        text: "text-red-700",
        icon: <XCircle className="w-3.5 h-3.5" />,
      },
      pending_review: {
        bg: "bg-yellow-50",
        text: "text-yellow-700",
        icon: <Clock className="w-3.5 h-3.5" />,
      },
      failed: {
        bg: "bg-red-50",
        text: "text-red-700",
        icon: <XCircle className="w-3.5 h-3.5" />,
      },
      dry_run_complete: {
        bg: "bg-purple-50",
        text: "text-purple-700",
        icon: <CheckCircle className="w-3.5 h-3.5" />,
      },
    };
    const s = map[status] ?? { bg: "bg-gray-50", text: "text-gray-700", icon: null };
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
      >
        {s.icon}
        {status.replace(/_/g, " ")}
      </span>
    );
  };

  const sessionIndicator = (platform: string) => {
    if (sessionsLoading) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          checking...
        </span>
      );
    }

    const session = sessions[platform] as SessionStatus | undefined;

    if (session?.valid) {
      const lastUpdated = session.last_updated
        ? new Date(session.last_updated).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "unknown";

      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <ShieldCheck className="w-3.5 h-3.5" />
          Session active ({lastUpdated})
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <ShieldAlert className="w-3.5 h-3.5" />
        No session
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Loading auto-apply queue...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-3">
            <Send className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Auto Apply</h1>
              <p className="text-sm text-gray-500">
                Review and approve auto-generated applications
              </p>
            </div>
          </div>

          {/* Login & Session Controls */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => handleLogin("linkedin")}
                  disabled={loginLoading !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0A66C2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#004182] disabled:opacity-50 transition-colors"
                >
                  {loginLoading === "linkedin" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  Login to LinkedIn
                </button>
                {sessionIndicator("linkedin")}
              </div>

              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => handleLogin("indeed")}
                  disabled={loginLoading !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2164f3] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0f4ebf] disabled:opacity-50 transition-colors"
                >
                  {loginLoading === "indeed" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  Login to Indeed
                </button>
                {sessionIndicator("indeed")}
              </div>
            </div>
          </div>
        </div>

        {/* Pending Review */}
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Pending Review
            {pendingItems.length > 0 && (
              <span className="ml-2 rounded-full bg-yellow-100 px-2.5 py-0.5 text-sm font-medium text-yellow-700">
                {pendingItems.length}
              </span>
            )}
          </h2>

          {pendingItems.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No pending applications to review.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingItems.map((item) => {
                const isProcessing = processingIds.has(item.id);
                const isApplying = applyingIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Building2 className="w-4 h-4 text-gray-400" />
                          <h3 className="font-semibold text-gray-900">
                            {item.job?.title ?? "Unknown Job"}
                          </h3>
                        </div>
                        <p className="text-sm text-gray-500">
                          {item.job?.company ?? "Unknown Company"}
                        </p>
                      </div>
                      {statusBadge(item.status)}
                    </div>

                    <div className="mb-4">
                      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                        <FileText className="w-4 h-4" />
                        Cover Letter Draft
                      </label>
                      <textarea
                        value={
                          editedLetters[item.id] ?? item.cover_letter_draft ?? ""
                        }
                        onChange={(e) =>
                          setEditedLetters((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        rows={6}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 resize-y"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleApprove(item)}
                        disabled={isProcessing || isApplying}
                        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => handleApplyNow(item)}
                        disabled={isProcessing || isApplying}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {isApplying ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        Apply Now
                      </button>
                      <button
                        onClick={() => handleReject(item)}
                        disabled={isProcessing || isApplying}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-colors"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <XCircle className="w-4 h-4" />
                        )}
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Submitted History */}
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">History</h2>

          {submittedItems.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No application history yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      Job
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      Company
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-gray-600">
                      Status
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {submittedItems.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-gray-900">
                        {item.job?.title ?? "Unknown"}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {item.job?.company ?? "Unknown"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {statusBadge(item.status)}
                      </td>
                      <td className="py-3 px-4 text-gray-500">
                        {item.submitted_at
                          ? new Date(item.submitted_at).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric", year: "numeric" }
                            )
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Activity Log */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <ScrollText className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
            <span className="text-xs text-gray-400 ml-2">auto-refreshes every 3s</span>
          </div>

          {logs.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No auto-apply activity yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-900 overflow-hidden shadow-sm">
              <div className="max-h-[500px] overflow-y-auto p-4 font-mono text-xs space-y-1">
                {logs.map((log) => {
                  const time = new Date(log.created_at).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  });
                  const levelColor =
                    log.level === "error"
                      ? "text-red-400"
                      : log.level === "warn"
                      ? "text-yellow-400"
                      : log.level === "success"
                      ? "text-green-400"
                      : "text-gray-400";
                  const actionColor =
                    log.action === "click"
                      ? "text-cyan-400"
                      : log.action === "type"
                      ? "text-purple-400"
                      : log.action === "navigate" || log.action === "page_loaded"
                      ? "text-blue-400"
                      : log.action === "done" || log.action === "dry_run_stop"
                      ? "text-green-400"
                      : log.action === "failed"
                      ? "text-red-400"
                      : "text-gray-300";

                  return (
                    <div key={log.id} className="flex gap-2 leading-relaxed">
                      <span className="text-gray-500 shrink-0">{time}</span>
                      {log.step_number != null && log.step_number > 0 && (
                        <span className="text-gray-600 shrink-0">
                          [{String(log.step_number).padStart(2, "0")}]
                        </span>
                      )}
                      <span className={`${levelColor} shrink-0 uppercase w-7`}>
                        {log.level === "info" ? "INF" : log.level === "error" ? "ERR" : log.level === "warn" ? "WRN" : "OK "}
                      </span>
                      <span className={`${actionColor} shrink-0 w-20 truncate`}>
                        {log.action}
                      </span>
                      <span className="text-gray-200 break-all">{log.detail}</span>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
