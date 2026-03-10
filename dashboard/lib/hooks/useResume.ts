"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

type Resume = Tables<"resumes">;

export function useResume() {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchResume = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("resumes")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    setResume(data as Resume | null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchResume();
  }, [fetchResume]);

  const uploadResume = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/resume", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      setResume(data.resume);
      return data.resume;
    }
    throw new Error("Upload failed");
  }, []);

  return { resume, loading, uploadResume, refetch: fetchResume };
}
