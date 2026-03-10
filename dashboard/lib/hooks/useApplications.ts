"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

type Application = Tables<"applications"> & {
  jobs?: Tables<"jobs">;
};

type Status = "saved" | "applied" | "interviewing" | "offer" | "rejected" | "withdrawn";

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select("*, jobs(*)")
      .order("updated_at", { ascending: false });

    if (!error && data) {
      setApplications(data as Application[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const saveJob = useCallback(async (jobId: string) => {
    const { data, error } = await supabase
      .from("applications")
      .insert({ job_id: jobId, status: "saved" as Status })
      .select("*, jobs(*)")
      .single();

    if (!error && data) {
      setApplications((prev) => [data as Application, ...prev]);
    }
    return { data, error };
  }, []);

  const updateStatus = useCallback(async (applicationId: string, status: string) => {
    const app = applications.find((a) => a.id === applicationId);
    const { error } = await supabase
      .from("applications")
      .update({
        status,
        applied_at: status === "applied" ? new Date().toISOString() : undefined,
      })
      .eq("id", applicationId);

    if (!error) {
      // Log event
      await supabase.from("application_events").insert({
        application_id: applicationId,
        event_type: "status_change",
        old_value: app?.status,
        new_value: status,
      });
      setApplications((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, status } : a))
      );
    }
    return { error };
  }, [applications]);

  const toggleFavorite = useCallback(async (applicationId: string) => {
    const app = applications.find((a) => a.id === applicationId);
    if (!app) return;
    const { error } = await supabase
      .from("applications")
      .update({ is_favorite: !app.is_favorite })
      .eq("id", applicationId);

    if (!error) {
      setApplications((prev) =>
        prev.map((a) =>
          a.id === applicationId ? { ...a, is_favorite: !a.is_favorite } : a
        )
      );
    }
  }, [applications]);

  const dismissJob = useCallback(async (applicationId: string) => {
    const { error } = await supabase
      .from("applications")
      .update({ is_dismissed: true })
      .eq("id", applicationId);

    if (!error) {
      setApplications((prev) => prev.filter((a) => a.id !== applicationId));
    }
  }, []);

  const grouped = {
    saved: applications.filter((a) => a.status === "saved" && !a.is_dismissed),
    applied: applications.filter((a) => a.status === "applied"),
    interviewing: applications.filter((a) => a.status === "interviewing"),
    offer: applications.filter((a) => a.status === "offer"),
    rejected: applications.filter((a) => a.status === "rejected"),
    withdrawn: applications.filter((a) => a.status === "withdrawn"),
  };

  return {
    applications,
    grouped,
    loading,
    saveJob,
    updateStatus,
    toggleFavorite,
    dismissJob,
    refetch: fetchApplications,
  };
}
