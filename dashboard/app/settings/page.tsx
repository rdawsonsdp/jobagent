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
  User,
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

interface UserProfile {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  linkedin_url: string;
  website_url: string;
  city: string;
  state: string;
  country: string;
  work_authorization: string;
  willing_to_relocate: boolean;
  desired_salary: string | null;
  years_experience: number | null;
  education_level: string;
}

const emptyUserProfile: UserProfile = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  linkedin_url: "",
  website_url: "",
  city: "",
  state: "",
  country: "United States",
  work_authorization: "Authorized to work",
  willing_to_relocate: false,
  desired_salary: null,
  years_experience: null,
  education_level: "",
};

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

  // User profile state
  const [userProfile, setUserProfile] = useState<UserProfile>({ ...emptyUserProfile });
  const [userProfileId, setUserProfileId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Form state for comma-separated inputs
  const [formJobTitles, setFormJobTitles] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formNegativeKeywords, setFormNegativeKeywords] = useState("");
  const [formLocations, setFormLocations] = useState("");

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [profilesRes, sourcesRes, userProfileRes] = await Promise.all([
      supabase.from("search_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("job_sources").select("*").order("name"),
      supabase.from("user_profile").select("*").limit(1).maybeSingle(),
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

    if (userProfileRes.error) {
      toast.error("Failed to load user profile");
    } else if (userProfileRes.data) {
      const d = userProfileRes.data as Record<string, any>;
      setUserProfileId(d.id);
      setUserProfile({
        id: d.id,
        first_name: d.first_name ?? "",
        last_name: d.last_name ?? "",
        email: d.email ?? "",
        phone: d.phone ?? "",
        linkedin_url: d.linkedin_url ?? "",
        website_url: d.website_url ?? "",
        city: d.city ?? "",
        state: d.state ?? "",
        country: d.country ?? "United States",
        work_authorization: d.work_authorization ?? "Authorized to work",
        willing_to_relocate: d.willing_to_relocate ?? false,
        desired_salary: d.desired_salary ?? null,
        years_experience: d.years_experience ?? null,
        education_level: d.education_level ?? "",
      });
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveUserProfile = async () => {
    setSavingProfile(true);
    const supabase = createClient();

    const payload = {
      first_name: userProfile.first_name || null,
      last_name: userProfile.last_name || null,
      email: userProfile.email || null,
      phone: userProfile.phone || null,
      linkedin_url: userProfile.linkedin_url || null,
      website_url: userProfile.website_url || null,
      city: userProfile.city || null,
      state: userProfile.state || null,
      country: userProfile.country || "United States",
      work_authorization: userProfile.work_authorization || "Authorized to work",
      willing_to_relocate: userProfile.willing_to_relocate,
      desired_salary: userProfile.desired_salary,
      years_experience: userProfile.years_experience,
      education_level: userProfile.education_level || null,
    };

    if (userProfileId) {
      const { error } = await supabase
        .from("user_profile")
        .update(payload)
        .eq("id", userProfileId);
      if (error) {
        toast.error("Failed to update profile");
      } else {
        toast.success("Profile saved successfully");
      }
    } else {
      const { data, error } = await supabase
        .from("user_profile")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        toast.error("Failed to save profile");
      } else {
        setUserProfileId(data.id);
        toast.success("Profile saved successfully");
      }
    }

    setSavingProfile(false);
  };

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

        {/* User Profile Section */}
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500 mb-5">
              Your personal details used when auto-applying to jobs.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  value={userProfile.first_name}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, first_name: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Jane"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  value={userProfile.last_name}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, last_name: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={userProfile.email}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, email: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="jane@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={userProfile.phone}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, phone: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="(555) 123-4567"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  LinkedIn URL
                </label>
                <input
                  type="url"
                  value={userProfile.linkedin_url}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, linkedin_url: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="https://linkedin.com/in/janedoe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Website URL
                </label>
                <input
                  type="url"
                  value={userProfile.website_url}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, website_url: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="https://janedoe.dev"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  type="text"
                  value={userProfile.city}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, city: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="San Francisco"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <input
                  type="text"
                  value={userProfile.state}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, state: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="California"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Country
                </label>
                <input
                  type="text"
                  value={userProfile.country}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, country: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="United States"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Work Authorization
                </label>
                <select
                  value={userProfile.work_authorization}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, work_authorization: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white"
                >
                  <option value="Authorized to work">Authorized to work</option>
                  <option value="US Citizen">US Citizen</option>
                  <option value="Green Card">Green Card</option>
                  <option value="H-1B">H-1B</option>
                  <option value="OPT/CPT">OPT/CPT</option>
                  <option value="Require sponsorship">Require sponsorship</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Desired Salary
                </label>
                <input
                  type="number"
                  value={userProfile.desired_salary ?? ""}
                  onChange={(e) =>
                    setUserProfile({
                      ...userProfile,
                      desired_salary: e.target.value || null,
                    })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="150000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Years of Experience
                </label>
                <input
                  type="number"
                  value={userProfile.years_experience ?? ""}
                  onChange={(e) =>
                    setUserProfile({
                      ...userProfile,
                      years_experience: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Education Level
                </label>
                <select
                  value={userProfile.education_level}
                  onChange={(e) =>
                    setUserProfile({ ...userProfile, education_level: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white"
                >
                  <option value="">Select...</option>
                  <option value="High School">High School</option>
                  <option value="Associate">Associate</option>
                  <option value="Bachelor">Bachelor</option>
                  <option value="Master">Master</option>
                  <option value="PhD">PhD</option>
                  <option value="Bootcamp">Bootcamp</option>
                  <option value="Self-taught">Self-taught</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={userProfile.willing_to_relocate}
                    onChange={(e) =>
                      setUserProfile({
                        ...userProfile,
                        willing_to_relocate: e.target.checked,
                      })
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Willing to Relocate
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={saveUserProfile}
                disabled={savingProfile}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {savingProfile ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Profile
              </button>
            </div>
          </div>
        </section>

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
