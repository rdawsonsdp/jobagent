"use client";

import Link from "next/link";
import { Tables } from "@/lib/supabase/types";
import RelevanceScore from "./RelevanceScore";
import { Bookmark, X, MapPin, Calendar, Zap, Wifi } from "lucide-react";

interface JobCardProps {
  job: Tables<"jobs">;
  onSave?: (jobId: string) => void;
  onDismiss?: (jobId: string) => void;
}

export default function JobCard({ job, onSave, onDismiss }: JobCardProps) {
  const postedDate = job.posted_date
    ? new Date(job.posted_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const keywords: string[] = Array.isArray(job.keywords)
    ? job.keywords
    : typeof job.keywords === "string"
      ? (job.keywords as string).split(",").map((k: string) => k.trim()).filter(Boolean)
      : [];

  return (
    <div className="group relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-300">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Link
              href={`/jobs/${job.id}`}
              className="text-lg font-semibold text-gray-900 hover:text-blue-600 truncate transition-colors"
            >
              {job.title}
            </Link>
            {job.is_remote && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 shrink-0">
                <Wifi className="w-3 h-3" />
                Remote
              </span>
            )}
            {job.easy_apply && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 shrink-0">
                <Zap className="w-3 h-3" />
                Easy Apply
              </span>
            )}
          </div>

          <p className="text-sm font-medium text-gray-600 mb-2">{job.company}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {job.location}
              </span>
            )}
            {job.salary_text && (
              <span className="font-medium text-gray-700">{job.salary_text}</span>
            )}
            {postedDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {postedDate}
              </span>
            )}
          </div>

          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keywords.slice(0, 8).map((keyword, i) => (
                <span
                  key={i}
                  className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                >
                  {keyword}
                </span>
              ))}
              {keywords.length > 8 && (
                <span className="text-xs text-gray-400">+{keywords.length - 8} more</span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 shrink-0">
          {job.relevance_score != null && (
            <RelevanceScore score={job.relevance_score} size="md" />
          )}

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onSave && (
              <button
                onClick={() => onSave(job.id)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                title="Save job"
              >
                <Bookmark className="w-4 h-4" />
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(job.id)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="Dismiss job"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
