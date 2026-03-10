"use client";

import { useState, useCallback } from "react";
import { useJobs } from "@/lib/hooks/useJobs";
import JobCard from "@/components/jobs/JobCard";
import JobFilters, { JobFiltersState } from "@/components/jobs/JobFilters";
import RelevanceScore from "@/components/jobs/RelevanceScore";
import { LayoutGrid, Table as TableIcon, MapPin, Calendar } from "lucide-react";

type ViewMode = "card" | "table";

export default function JobsPage() {
  const [filters, setFilters] = useState<JobFiltersState>({
    search: "",
    minScore: 0,
    remoteOnly: false,
    sortBy: "relevance_score",
    sortDir: "desc",
  });
  const [viewMode, setViewMode] = useState<ViewMode>("card");

  const { jobs, loading } = useJobs(filters);

  const handleSave = useCallback((jobId: string) => {
    console.log("Save job:", jobId);
  }, []);

  const handleDismiss = useCallback((jobId: string) => {
    console.log("Dismiss job:", jobId);
  }, []);

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
              </p>
            )}
          </div>

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
                  <JobCard
                    key={job.id}
                    job={job}
                    onSave={handleSave}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
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
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
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
