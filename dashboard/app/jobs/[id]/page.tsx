"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Tables } from "@/lib/supabase/types";
import RelevanceScore from "@/components/jobs/RelevanceScore";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bookmark,
  ExternalLink,
  XCircle,
  MapPin,
  Calendar,
  Building2,
  DollarSign,
  Wifi,
  Zap,
  Clock,
  Brain,
} from "lucide-react";

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Tables<"jobs"> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchJob() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("jobs")
        .select()
        .eq("id", params.id as string)
        .single();

      if (error) {
        toast.error("Failed to load job details");
        console.error(error);
      } else {
        setJob(data as Tables<"jobs">);
      }
      setLoading(false);
    }

    if (params.id) {
      fetchJob();
    }
  }, [params.id]);

  const handleSave = async () => {
    if (!job) return;
    const supabase = createClient();
    const { error } = await supabase.from("applications").insert({
      job_id: job.id,
      status: "saved",
    });
    if (error) {
      toast.error("Failed to save job");
    } else {
      toast.success("Job saved to pipeline");
    }
  };

  const handleApply = () => {
    if (!job?.url) {
      toast.error("No application URL available");
      return;
    }
    window.open(job.url, "_blank", "noopener,noreferrer");
  };

  const handleDismiss = async () => {
    if (!job) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ is_active: false })
      .eq("id", job.id);
    if (error) {
      toast.error("Failed to dismiss job");
    } else {
      toast.success("Job dismissed");
      router.push("/jobs");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-24 mb-8" />
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            <div className="h-8 bg-gray-200 rounded w-2/3 mb-4" />
            <div className="h-5 bg-gray-100 rounded w-1/3 mb-6" />
            <div className="flex gap-4 mb-8">
              <div className="h-4 bg-gray-100 rounded w-28" />
              <div className="h-4 bg-gray-100 rounded w-24" />
              <div className="h-4 bg-gray-100 rounded w-32" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 bg-gray-100 rounded" style={{ width: `${85 - i * 5}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-lg">Job not found.</p>
          <button
            onClick={() => router.push("/jobs")}
            className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Back to jobs
          </button>
        </div>
      </div>
    );
  }

  const keywords: string[] = Array.isArray(job.keywords)
    ? job.keywords
    : typeof job.keywords === "string"
      ? (job.keywords as string).split(",").map((k: string) => k.trim()).filter(Boolean)
      : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back button */}
        <button
          onClick={() => router.push("/jobs")}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to jobs
        </button>

        {/* Main card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="p-8 border-b border-gray-100">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{job.title}</h1>
                <div className="flex items-center gap-2 text-gray-600 mb-4">
                  <Building2 className="w-4 h-4" />
                  <span className="font-medium">{job.company}</span>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-500">
                  {job.location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" />
                      {job.location}
                    </span>
                  )}
                  {job.salary_text && (
                    <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                      <DollarSign className="w-4 h-4" />
                      {job.salary_text}
                    </span>
                  )}
                  {job.posted_date && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      {new Date(job.posted_date).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  {job.created_at && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      Added {new Date(job.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  {job.is_remote && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      <Wifi className="w-3 h-3" />
                      Remote
                    </span>
                  )}
                  {job.easy_apply && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                      <Zap className="w-3 h-3" />
                      Easy Apply
                    </span>
                  )}
                </div>
              </div>

              {job.relevance_score != null && (
                <RelevanceScore score={job.relevance_score} size="lg" />
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-6 pt-6 border-t border-gray-100">
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <Bookmark className="w-4 h-4" />
                Save
              </button>
              <button
                onClick={handleApply}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Apply
              </button>
              <button
                onClick={handleDismiss}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Dismiss
              </button>
            </div>
          </div>

          {/* Score reasoning */}
          {job.score_reasoning && (
            <div className="p-8 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-semibold text-gray-900">Score Reasoning</h2>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {job.score_reasoning}
              </p>
            </div>
          )}

          {/* Keywords */}
          {keywords.length > 0 && (
            <div className="p-8 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Keywords</h2>
              <div className="flex flex-wrap gap-2">
                {keywords.map((keyword, i) => (
                  <span
                    key={i}
                    className="inline-block rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Job description */}
          <div className="p-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Description</h2>
            {job.description_html ? (
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: job.description_html }}
              />
            ) : job.description_text ? (
              <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {job.description_text}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No description available.</p>
            )}
          </div>

          {/* Metadata */}
          <div className="p-8 border-t border-gray-100 bg-gray-50/50">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {job.source_id && (
                <div>
                  <dt className="text-gray-500">Source ID</dt>
                  <dd className="font-medium text-gray-900 mt-0.5 font-mono text-xs">{job.source_id}</dd>
                </div>
              )}
              {job.external_id && (
                <div>
                  <dt className="text-gray-500">External ID</dt>
                  <dd className="font-medium text-gray-900 mt-0.5 font-mono text-xs">{job.external_id}</dd>
                </div>
              )}
              {job.url && (
                <div className="sm:col-span-2">
                  <dt className="text-gray-500">URL</dt>
                  <dd className="mt-0.5">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 text-xs break-all"
                    >
                      {job.url}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
