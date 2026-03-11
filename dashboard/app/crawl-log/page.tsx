"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  Activity,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Play,
  Square,
} from "lucide-react";

interface CrawlRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_jobs_found: number | null;
  new_jobs_added: number | null;
  duplicates_skipped: number | null;
  errors: number | null;
  source_stats: Record<string, unknown> | null;
}

interface RecentJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  relevance_score: number | null;
  is_remote: boolean | null;
  created_at: string | null;
}

export default function CrawlLogPage() {
  const [runs, setRuns] = useState<CrawlRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [crawlerRunning, setCrawlerRunning] = useState(false);
  const [crawlerLoading, setCrawlerLoading] = useState(false);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkCrawlerStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/crawler");
      const data = await res.json();
      setCrawlerRunning(data.running);
    } catch {
      // ignore
    }
  }, []);

  const fetchRecentJobs = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("jobs")
      .select("id, title, company, location, relevance_score, is_remote, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setRecentJobs(data as RecentJob[]);
  }, []);

  const fetchRuns = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("crawl_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) {
      toast.error("Failed to load crawl runs");
      console.error(error);
    } else {
      setRuns(data as CrawlRun[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRuns();
    fetchRecentJobs();
    checkCrawlerStatus();

    // Poll every 5 seconds when crawler is running
    pollRef.current = setInterval(() => {
      checkCrawlerStatus();
      fetchRecentJobs();
      fetchRuns();
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRuns, fetchRecentJobs, checkCrawlerStatus]);

  const startCrawler = async () => {
    setCrawlerLoading(true);
    try {
      const res = await fetch("/api/crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", budget: 30 }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Crawler started");
        setCrawlerRunning(true);
      } else {
        toast.error(data.error || "Failed to start crawler");
      }
    } catch {
      toast.error("Failed to start crawler");
    }
    setCrawlerLoading(false);
  };

  const stopCrawler = async () => {
    setCrawlerLoading(true);
    try {
      const res = await fetch("/api/crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Crawler stopped");
        setCrawlerRunning(false);
      } else {
        toast.error(data.error || "Failed to stop crawler");
      }
    } catch {
      toast.error("Failed to stop crawler");
    }
    setCrawlerLoading(false);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const map: Record<
      string,
      { bg: string; text: string; icon: React.ReactNode }
    > = {
      completed: {
        bg: "bg-green-50",
        text: "text-green-700",
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      },
      running: {
        bg: "bg-blue-50",
        text: "text-blue-700",
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      },
      failed: {
        bg: "bg-red-50",
        text: "text-red-700",
        icon: <XCircle className="w-3.5 h-3.5" />,
      },
      pending: {
        bg: "bg-yellow-50",
        text: "text-yellow-700",
        icon: <Clock className="w-3.5 h-3.5" />,
      },
      partial: {
        bg: "bg-amber-50",
        text: "text-amber-700",
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
      },
    };
    const s = map[status] ?? {
      bg: "bg-gray-50",
      text: "text-gray-700",
      icon: null,
    };
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
      >
        {s.icon}
        {status}
      </span>
    );
  };

  const formatDatetime = (dt: string | null) => {
    if (!dt) return "-";
    return new Date(dt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getDuration = (start: string, end: string | null) => {
    if (!end) return "-";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return `${mins}m ${remainSecs}s`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Loading crawl log...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Crawl Log</h1>
              <p className="text-sm text-gray-500">
                History of job crawl runs and their results
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {crawlerRunning && (
              <span className="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                Crawling...
              </span>
            )}
            {crawlerRunning ? (
              <button
                onClick={stopCrawler}
                disabled={crawlerLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {crawlerLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                Stop Crawler
              </button>
            ) : (
              <button
                onClick={startCrawler}
                disabled={crawlerLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {crawlerLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Start Crawler
              </button>
            )}
          </div>
        </div>

        {/* Live Job Feed */}
        {recentJobs.length > 0 && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Recent Jobs (live)</h2>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
              {recentJobs.map((job) => (
                <div key={job.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900 truncate block">{job.title}</span>
                    <span className="text-gray-500 text-xs">
                      {job.company ?? "Unknown"} &middot; {job.location ?? "N/A"}
                      {job.is_remote && " (Remote)"}
                    </span>
                  </div>
                  <div className="ml-4 shrink-0">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        (job.relevance_score ?? 0) >= 7
                          ? "bg-green-100 text-green-800"
                          : (job.relevance_score ?? 0) >= 4
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {job.relevance_score?.toFixed(1) ?? "-"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {runs.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500">No crawl runs recorded yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-8 py-3 px-2" />
                  <th className="text-left py-3 px-4 font-medium text-gray-600">
                    Started
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">
                    Finished
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">
                    Duration
                  </th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">
                    Status
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">
                    Found
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">
                    New
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">
                    Dupes
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">
                    Errors
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const isExpanded = expandedIds.has(run.id);
                  const hasStats =
                    run.source_stats &&
                    Object.keys(run.source_stats).length > 0;

                  return (
                    <Fragment key={run.id}>
                      <tr
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                          hasStats ? "cursor-pointer" : ""
                        }`}
                        onClick={() => hasStats && toggleExpand(run.id)}
                      >
                        <td className="py-3 px-2 text-center">
                          {hasStats ? (
                            isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400 mx-auto" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400 mx-auto" />
                            )
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-gray-700">
                          {formatDatetime(run.started_at)}
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {formatDatetime(run.finished_at)}
                        </td>
                        <td className="py-3 px-4 text-gray-500 font-mono text-xs">
                          {getDuration(run.started_at, run.finished_at)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {statusBadge(run.status)}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-gray-900">
                          {run.total_jobs_found ?? "-"}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-green-700">
                          {run.new_jobs_added ?? "-"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-500">
                          {run.duplicates_skipped ?? "-"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span
                            className={
                              (run.errors ?? 0) > 0
                                ? "font-medium text-red-600"
                                : "text-gray-500"
                            }
                          >
                            {run.errors ?? 0}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && hasStats && (
                        <tr className="border-b border-gray-100">
                          <td colSpan={9} className="py-4 px-8 bg-gray-50/70">
                            <div className="text-xs font-medium text-gray-500 mb-2">
                              Source Stats
                            </div>
                            <pre className="text-xs text-gray-700 bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto font-mono">
                              {JSON.stringify(run.source_stats, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Fragment import
import { Fragment } from "react";
