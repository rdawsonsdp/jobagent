"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

type Job = Tables<"jobs">;

interface JobFilters {
  search?: string;
  source?: string;
  minScore?: number;
  remoteOnly?: boolean;
  sortBy?: "relevance_score" | "created_at" | "posted_date";
  sortDir?: "asc" | "desc";
}

export function useJobs(filters: JobFilters = {}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const supabase = createClient();

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("jobs")
      .select("*", { count: "exact" })
      .eq("is_active", true);

    if (filters.search) {
      query = query.or(
        `title.ilike.%${filters.search}%,company.ilike.%${filters.search}%`
      );
    }
    if (filters.source) {
      query = query.eq("source_id", filters.source);
    }
    if (filters.minScore) {
      query = query.gte("relevance_score", filters.minScore);
    }
    if (filters.remoteOnly) {
      query = query.eq("is_remote", true);
    }

    const sortBy = filters.sortBy || "created_at";
    const sortDir = filters.sortDir || "desc";
    query = query.order(sortBy, { ascending: sortDir === "asc", nullsFirst: false });
    query = query.limit(50);

    const { data, count: totalCount, error } = await query;
    if (!error && data) {
      setJobs(data as unknown as Job[]);
      setCount(totalCount ?? 0);
    }
    setLoading(false);
  }, [filters.search, filters.source, filters.minScore, filters.remoteOnly, filters.sortBy, filters.sortDir]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("jobs-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "jobs" },
        (payload) => {
          setJobs((prev) => [payload.new as Job, ...prev]);
          setCount((c) => c + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { jobs, loading, count, refetch: fetchJobs };
}
