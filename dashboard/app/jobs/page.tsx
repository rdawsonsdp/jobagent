"use client";

import { useState, useCallback, useEffect } from "react";
import { useJobs } from "@/lib/hooks/useJobs";
import { createClient } from "@/lib/supabase/client";
import JobCard from "@/components/jobs/JobCard";
import JobFilters, { JobFiltersState } from "@/components/jobs/JobFilters";
import RelevanceScore from "@/components/jobs/RelevanceScore";
import { toast } from "sonner";
import {
  LayoutGrid,
  Table as TableIcon,
  MapPin,
  Calendar,
  Trash2,
  CheckSquare,
  Square,
  Loader2,
  Send,
  Play,
  LogIn,
  Shield,
  ShieldCheck,
} from "lucide-react";

type ViewMode = "card" | "table";

interface SessionInfo {
  valid: boolean;
  last_updated: string | null;
}

export default function JobsPage() {
  const [filters, setFilters] = useState<JobFiltersState>({
    search: "",
    minScore: 0,
    remoteOnly: false,
    sortBy: "relevance_score",
    sortDir: "desc",
  });
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [loginPlatform, setLoginPlatform] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({});

  const { jobs, loading, refetch } = useJobs(filters);

  const allSelected = jobs.length > 0 && selectedIds.size === jobs.length;

  // Check session status on mount
  useEffect(() => {
    const checkSessions = async () => {
      try {
        const res = await fetch("/api/auto-apply");
        const data = await res.json();
        if (data.sessions) setSessions(data.sessions);
      } catch {
        // ignore
      }
    };
    checkSessions();
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.id)));
    }
  }, [allSelected, jobs]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const supabase = createClient();
    const ids = Array.from(selectedIds);

    const { error } = await supabase.from("jobs").delete().in("id", ids);

    if (error) {
      toast.error("Failed to delete jobs");
      console.error(error);
    } else {
      toast.success(`Deleted ${ids.length} job${ids.length > 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      refetch();
    }
    setDeleting(false);
  };

  const deleteAll = async () => {
    if (jobs.length === 0) return;
    setDeleting(true);
    const supabase = createClient();
    const ids = jobs.map((j) => j.id);

    const { error } = await supabase.from("jobs").delete().in("id", ids);

    if (error) {
      toast.error("Failed to delete jobs");
      console.error(error);
    } else {
      toast.success(`Deleted ${ids.length} job${ids.length > 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      refetch();
    }
    setDeleting(false);
  };

  const queueForAutoApply = async () => {
    if (selectedIds.size === 0) return;
    setQueueing(true);
    try {
      const res = await fetch("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "queue-jobs",
          jobIds: Array.from(selectedIds),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setSelectedIds(new Set());
      } else {
        toast.error(data.error || "Failed to queue jobs");
      }
    } catch {
      toast.error("Failed to queue jobs");
    }
    setQueueing(false);
  };

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
        toast.success("Auto-apply started! Check the auto-apply page for progress.");
      } else {
        toast.error(data.error || "Failed to start auto-apply");
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
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `${platform} login browser opened. Log in manually, then close the browser.`
        );
      } else {
        toast.error(data.error || `Failed to open ${platform} login`);
      }
    } catch {
      toast.error(`Failed to open ${platform} login`);
    }
    setLoginPlatform(null);
  };

  const handleSave = useCallback((jobId: string) => {
    console.log("Save job:", jobId);
  }, []);

  const handleDismiss = useCallback((jobId: string) => {
    console.log("Dismiss job:", jobId);
  }, []);

  const hasIndeedSession = sessions.indeed?.valid;
  const hasLinkedInSession = sessions.linkedin?.valid;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
            {!loading && (
              <p className="text-sm text-gray-500 mt-1">
                {jobs.length} job{jobs.length !== 1 ? "s" : ""} found
                {selectedIds.size > 0 && (
                  <span className="ml-2 text-blue-600 font-medium">
                    ({selectedIds.size} selected)
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Auto Apply actions */}
            {selectedIds.size > 0 && (
              <button
                onClick={queueForAutoApply}
                disabled={queueing}
                className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
              >
                {queueing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Auto Apply ({selectedIds.size})
              </button>
            )}

            <button
              onClick={executeAutoApply}
              disabled={executing}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {executing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Execute Auto Apply
            </button>

            {/* Bulk delete */}
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {deleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete ({selectedIds.size})
              </button>
            )}
            <button
              onClick={deleteAll}
              disabled={deleting || jobs.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </button>

            {/* View toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
              <button
                onClick={() => setViewMode("card")}
                className={`rounded-md p-2 transition-colors ${
                  viewMode === "card"
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                title="Card view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`rounded-md p-2 transition-colors ${
                  viewMode === "table"
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                title="Table view"
              >
                <TableIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Session Status / Login Bar */}
        <div className="mb-4 flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-sm font-medium text-gray-600">Sessions:</span>
          <div className="flex items-center gap-1.5">
            {hasIndeedSession ? (
              <ShieldCheck className="w-4 h-4 text-green-600" />
            ) : (
              <Shield className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm ${hasIndeedSession ? "text-green-700" : "text-gray-500"}`}>
              Indeed
            </span>
            {!hasIndeedSession && (
              <button
                onClick={() => loginToPlatform("indeed")}
                disabled={loginPlatform === "indeed"}
                className="ml-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
              >
                {loginPlatform === "indeed" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <LogIn className="w-3 h-3" />
                )}
                Login
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {hasLinkedInSession ? (
              <ShieldCheck className="w-4 h-4 text-green-600" />
            ) : (
              <Shield className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm ${hasLinkedInSession ? "text-green-700" : "text-gray-500"}`}>
              LinkedIn
            </span>
            {!hasLinkedInSession && (
              <button
                onClick={() => loginToPlatform("linkedin")}
                disabled={loginPlatform === "linkedin"}
                className="ml-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
              >
                {loginPlatform === "linkedin" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <LogIn className="w-3 h-3" />
                )}
                Login
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6">
          <JobFilters filters={filters} onFiltersChange={setFilters} />
        </div>

        {/* Loading Skeleton */}
        {loading && (
          <>
            {viewMode === "card" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <div className="h-5 bg-gray-200 rounded w-3/4 mb-3" />
                        <div className="h-4 bg-gray-100 rounded w-1/2 mb-2" />
                        <div className="h-3 bg-gray-100 rounded w-2/3 mb-4" />
                        <div className="flex gap-2">
                          <div className="h-5 bg-gray-100 rounded w-16" />
                          <div className="h-5 bg-gray-100 rounded w-12" />
                          <div className="h-5 bg-gray-100 rounded w-20" />
                        </div>
                      </div>
                      <div className="w-14 h-14 bg-gray-200 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden animate-pulse">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex gap-4 p-4 border-b border-gray-100">
                    <div className="h-4 bg-gray-200 rounded w-1/4" />
                    <div className="h-4 bg-gray-100 rounded w-1/6" />
                    <div className="h-4 bg-gray-100 rounded w-12" />
                    <div className="h-4 bg-gray-100 rounded w-1/5" />
                    <div className="h-4 bg-gray-100 rounded w-20" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Content */}
        {!loading && (
          <>
            {jobs.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-lg">No jobs match your filters.</p>
                <p className="text-gray-400 text-sm mt-1">
                  Try adjusting your search criteria or lowering the minimum score.
                </p>
              </div>
            ) : viewMode === "card" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {jobs.map((job) => (
                  <div key={job.id} className="relative">
                    <button
                      onClick={() => toggleSelect(job.id)}
                      className="absolute top-3 left-3 z-10"
                    >
                      {selectedIds.has(job.id) ? (
                        <CheckSquare className="w-5 h-5 text-blue-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-300 hover:text-gray-500" />
                      )}
                    </button>
                    <JobCard
                      job={job}
                      onSave={handleSave}
                      onDismiss={handleDismiss}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="w-10 py-3 px-2 text-center">
                        <button onClick={toggleSelectAll}>
                          {allSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600 mx-auto" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-400 mx-auto" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Title</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Company</th>
                      <th className="text-center py-3 px-4 font-medium text-gray-600">Score</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Location</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Posted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr
                        key={job.id}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                          selectedIds.has(job.id) ? "bg-blue-50/50" : ""
                        }`}
                      >
                        <td className="py-3 px-2 text-center">
                          <button onClick={() => toggleSelect(job.id)}>
                            {selectedIds.has(job.id) ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-300 hover:text-gray-500" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <a
                            href={`/jobs/${job.id}`}
                            className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                          >
                            {job.title}
                          </a>
                        </td>
                        <td className="py-3 px-4 text-gray-600">{job.company}</td>
                        <td className="py-3 px-4 text-center">
                          {job.relevance_score != null && (
                            <div className="flex justify-center">
                              <RelevanceScore score={job.relevance_score} size="sm" />
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-600">
                          {job.location && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5" />
                              {job.location}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {job.posted_date && (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              {new Date(job.posted_date).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
