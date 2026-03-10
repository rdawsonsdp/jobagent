"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  Settings,
  Plus,
  Trash2,
  Save,
  Loader2,
  Globe,
  Search,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface SearchProfile {
  id?: string;
  name: string;
  job_titles: string[];
  keywords: string[];
  negative_keywords: string[];
  locations: string[];
  remote_only: boolean;
  min_salary: number | null;
  min_relevance_score: number | null;
}

interface JobSource {
  id: string;
  name: string;
  type: string;
  url: string | null;
  enabled: boolean;
}

const emptyProfile: SearchProfile = {
  name: "",
  job_titles: [],
  keywords: [],
  negative_keywords: [],
  locations: [],
  remote_only: false,
  min_salary: null,
  min_relevance_score: null,
};

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<SearchProfile[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState<SearchProfile | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state for comma-separated inputs
  const [formJobTitles, setFormJobTitles] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formNegativeKeywords, setFormNegativeKeywords] = useState("");
  const [formLocations, setFormLocations] = useState("");

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [profilesRes, sourcesRes] = await Promise.all([
      supabase.from("search_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("job_sources").select("*").order("name"),
    ]);

    if (profilesRes.error) {
      toast.error("Failed to load search profiles");
    } else {
      setProfiles(profilesRes.data as SearchProfile[]);
    }

    if (sourcesRes.error) {
      toast.error("Failed to load job sources");
    } else {
      setSources(sourcesRes.data as JobSource[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startEditing = (profile: SearchProfile) => {
    setEditingProfile({ ...profile });
    setFormJobTitles((profile.job_titles ?? []).join(", "));
    setFormKeywords((profile.keywords ?? []).join(", "));
    setFormNegativeKeywords((profile.negative_keywords ?? []).join(", "));
    setFormLocations((profile.locations ?? []).join(", "));
  };

  const startNew = () => {
    setEditingProfile({ ...emptyProfile });
    setFormJobTitles("");
    setFormKeywords("");
    setFormNegativeKeywords("");
    setFormLocations("");
  };

  const cancelEditing = () => {
    setEditingProfile(null);
  };

  const parseCommaSeparated = (val: string): string[] =>
    val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const saveProfile = async () => {
    if (!editingProfile) return;

    const profile = {
      ...editingProfile,
      job_titles: parseCommaSeparated(formJobTitles),
      keywords: parseCommaSeparated(formKeywords),
      negative_keywords: parseCommaSeparated(formNegativeKeywords),
      locations: parseCommaSeparated(formLocations),
    };

    if (!profile.name.trim()) {
      toast.error("Profile name is required");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    if (profile.id) {
      // Update
      const { error } = await supabase
        .from("search_profiles")
        .update({
          name: profile.name,
          job_titles: profile.job_titles,
          keywords: profile.keywords,
          negative_keywords: profile.negative_keywords,
          locations: profile.locations,
          remote_only: profile.remote_only,
          min_salary: profile.min_salary,
          min_relevance_score: profile.min_relevance_score,
        })
        .eq("id", profile.id);

      if (error) {
        toast.error("Failed to update profile");
      } else {
        toast.success("Profile updated");
        setEditingProfile(null);
        fetchData();
      }
    } else {
      // Insert
      const { error } = await supabase.from("search_profiles").insert({
        name: profile.name,
        job_titles: profile.job_titles,
        keywords: profile.keywords,
        negative_keywords: profile.negative_keywords,
        locations: profile.locations,
        remote_only: profile.remote_only,
        min_salary: profile.min_salary,
        min_relevance_score: profile.min_relevance_score,
      });

      if (error) {
        toast.error("Failed to create profile");
      } else {
        toast.success("Profile created");
        setEditingProfile(null);
        fetchData();
      }
    }

    setSaving(false);
  };

  const deleteProfile = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("search_profiles").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete profile");
    } else {
      toast.success("Profile deleted");
      fetchData();
    }
  };

  const toggleSource = async (source: JobSource) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("job_sources")
      .update({ enabled: !source.enabled })
      .eq("id", source.id);

    if (error) {
      toast.error("Failed to update source");
    } else {
      setSources((prev) =>
        prev.map((s) =>
          s.id === source.id ? { ...s, enabled: !s.enabled } : s
        )
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Settings className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500">
              Manage search profiles and job sources
            </p>
          </div>
        </div>

        {/* Search Profiles Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Search Profiles
              </h2>
            </div>
            <button
              onClick={startNew}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Profile
            </button>
          </div>

          {/* Profile Form */}
          {editingProfile && (
            <div className="rounded-xl border border-blue-200 bg-white p-6 mb-4 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-4">
                {editingProfile.id ? "Edit Profile" : "New Profile"}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={editingProfile.name}
                    onChange={(e) =>
                      setEditingProfile({ ...editingProfile, name: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., Senior Frontend React"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Job Titles (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formJobTitles}
                    onChange={(e) => setFormJobTitles(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., Senior Engineer, Staff Engineer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Keywords (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formKeywords}
                    onChange={(e) => setFormKeywords(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., React, TypeScript, Node.js"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Negative Keywords (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formNegativeKeywords}
                    onChange={(e) => setFormNegativeKeywords(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., Junior, Intern, PHP"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Locations (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formLocations}
                    onChange={(e) => setFormLocations(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., San Francisco, New York, Remote"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Min Salary
                  </label>
                  <input
                    type="number"
                    value={editingProfile.min_salary ?? ""}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        min_salary: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., 150000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Min Relevance Score (0-10)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={editingProfile.min_relevance_score ?? ""}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        min_relevance_score: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="e.g., 7"
                  />
                </div>

                <div className="flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingProfile.remote_only}
                      onChange={(e) =>
                        setEditingProfile({
                          ...editingProfile,
                          remote_only: e.target.checked,
                        })
                      }
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Remote Only
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {editingProfile.id ? "Update" : "Create"}
                </button>
                <button
                  onClick={cancelEditing}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Profile List */}
          {profiles.length === 0 && !editingProfile ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No search profiles yet.</p>
              <p className="text-sm text-gray-400 mt-1">
                Create one to start finding relevant jobs.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{profile.name}</h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
                        {profile.job_titles?.length > 0 && (
                          <span>
                            Titles: {profile.job_titles.join(", ")}
                          </span>
                        )}
                        {profile.locations?.length > 0 && (
                          <span>
                            Locations: {profile.locations.join(", ")}
                          </span>
                        )}
                        {profile.remote_only && (
                          <span className="text-blue-600 font-medium">Remote only</span>
                        )}
                        {profile.min_salary && (
                          <span>Min salary: ${profile.min_salary.toLocaleString()}</span>
                        )}
                        {profile.min_relevance_score && (
                          <span>Min score: {profile.min_relevance_score}</span>
                        )}
                      </div>
                      {profile.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {profile.keywords.map((kw, i) => (
                            <span
                              key={i}
                              className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => startEditing(profile)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => profile.id && deleteProfile(profile.id)}
                        className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                        title="Delete profile"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Job Sources Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">Job Sources</h2>
          </div>

          {sources.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No job sources configured.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      Name
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      Type
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      URL
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-gray-600">
                      Enabled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr
                      key={source.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-gray-900">
                        {source.name}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        <span className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {source.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs truncate max-w-[300px]">
                        {source.url ?? "-"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleSource(source)}
                          className="inline-flex items-center justify-center"
                          title={source.enabled ? "Disable" : "Enable"}
                        >
                          {source.enabled ? (
                            <ToggleRight className="w-8 h-8 text-green-600" />
                          ) : (
                            <ToggleLeft className="w-8 h-8 text-gray-300" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
