"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  Search as SearchIcon,
  Loader2,
  Trash2,
  ExternalLink,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  MapPin,
  Globe,
  Send,
  X,
  CheckCircle2,
  MessageSquare,
  Eye,
  EyeOff,
  ScanSearch,
  Info,
  Briefcase,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

interface TargetCompany {
  id: string;
  name: string;
  industry: string | null;
  careers_url: string | null;
  ats_type: string | null;
  discovery_source: string | null;
  location: string | null;
  distance_tier: string | null;
  priority: number;
  enabled: boolean;
  watched: boolean;
  last_crawled_at: string | null;
  jobs_found: number;
  created_at: string;
  crawl_status: string | null;
  crawl_error: string | null;
  matched_jobs_count: number | null;
  avg_match_confidence: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const TIER_COLORS: Record<string, string> = {
  local: "bg-green-100 text-green-700",
  regional: "bg-blue-100 text-blue-700",
  national: "bg-purple-100 text-purple-700",
  remote: "bg-amber-100 text-amber-700",
};

const TIER_ORDER = ["local", "regional", "national", "remote"];

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<TargetCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCareersUrl, setNewCareersUrl] = useState("");
  const [newIndustry, setNewIndustry] = useState("");

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (data.companies) setCompanies(data.companies);
    } catch {
      toast.error("Failed to load companies");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Discovery chat state
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [readyToDiscover, setReadyToDiscover] = useState(false);
  const [savingCompanies, setSavingCompanies] = useState(false);
  const [discoveredCompanies, setDiscoveredCompanies] = useState<Record<string, unknown>[]>([]);
  const [discoverySaved, setDiscoverySaved] = useState(false);
  const [savePromptChecked, setSavePromptChecked] = useState(true);
  const [promptName, setPromptName] = useState("My Discovery");
  const [promptSchedule, setPromptSchedule] = useState("weekly");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Needs-info state: when crawl agent asks for more candidate info
  const [needsInfoCompanyId, setNeedsInfoCompanyId] = useState<string | null>(null);
  const [needsInfoPrompt, setNeedsInfoPrompt] = useState("");
  const [needsInfoInput, setNeedsInfoInput] = useState("");

  // Crawl activity log
  interface CrawlLogEntry {
    companyName: string;
    status: "crawling" | "completed" | "failed";
    jobsFound?: number;
    error?: string;
    timestamp: Date;
  }
  const [crawlLog, setCrawlLog] = useState<CrawlLogEntry[]>([]);
  const [crawlRunning, setCrawlRunning] = useState(false);
  const crawlLogRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, streaming]);

  const openDiscovery = () => {
    setShowDiscovery(true);
    setChatMessages([]);
    setChatInput("");
    setReadyToDiscover(false);
    setDiscoveredCompanies([]);
    setDiscoverySaved(false);
    setSavePromptChecked(true);
    setPromptName("My Discovery");
    setPromptSchedule("weekly");
    // Send initial message to kick off the conversation
    sendMessage("Hi! I'd like to discover companies that would be a good fit for me.", true);
  };

  const streamResponse = async (messages: ChatMessage[], generateCompanies = false) => {
    setStreaming(true);

    let assistantText = "";

    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, generateCompanies }),
      });

      if (!res.ok) {
        let errMsg = "Discovery failed";
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch { /* not JSON */ }
        toast.error(errMsg);
        setStreaming(false);
        return;
      }

      // Add empty assistant message to stream into
      setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      // Try to read as a stream first; fall back to reading full text
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            // Keep the last (possibly incomplete) line in the buffer
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;

              try {
                const parsed = JSON.parse(payload);
                if (parsed.text) {
                  assistantText += parsed.text;
                  setChatMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantText,
                    };
                    return updated;
                  });
                }
                if (parsed.error) {
                  toast.error(parsed.error);
                }
              } catch {
                // Ignore parse errors on partial chunks
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        // Fallback: read entire response as text and parse SSE lines
        const text = await res.text();
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) {
              assistantText += parsed.text;
            }
          } catch { /* skip */ }
        }
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: assistantText,
          };
          return updated;
        });
      }

      // Check if Claude is ready to discover
      if (assistantText.includes("[READY_TO_DISCOVER]")) {
        setReadyToDiscover(true);
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: assistantText.replace("[READY_TO_DISCOVER]", "").trim(),
          };
          return updated;
        });
      }

      // Check if response contains JSON companies
      if (generateCompanies) {
        try {
          const jsonMatch = assistantText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setDiscoveredCompanies(parsed);
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: `I found ${parsed.length} companies that would be a great fit! Review them below and click "Save Companies" to add them to your target list.`,
                };
                return updated;
              });
            }
          }
        } catch {
          // Not valid JSON yet
        }
      }
    } catch (err) {
      console.error("Discovery stream error:", err);
      toast.error("Connection error during discovery");
    } finally {
      setStreaming(false);
    }
  };

  const sendMessage = async (text?: string, isInitial = false) => {
    const content = text || chatInput.trim();
    if (!content || streaming) return;

    const userMsg: ChatMessage = { role: "user", content };
    const allMessages = isInitial ? [userMsg] : [...chatMessages, userMsg];

    if (!isInitial) {
      setChatMessages((prev) => [...prev, userMsg]);
    } else {
      setChatMessages([userMsg]);
    }
    setChatInput("");

    await streamResponse(allMessages);
  };

  const generateCompanyList = async () => {
    await streamResponse(chatMessages, true);
  };

  // Crawl a batch of companies with visible progress log
  const crawlCompaniesWithLog = async (companyList: { id: string; name: string }[]) => {
    if (companyList.length === 0) return;
    setCrawlRunning(true);
    setCrawlLog([]);

    for (const company of companyList) {
      // Add "crawling" entry
      setCrawlLog((prev) => [
        ...prev,
        { companyName: company.name, status: "crawling", timestamp: new Date() },
      ]);
      // Auto-scroll the log
      setTimeout(() => crawlLogRef.current?.scrollTo({ top: crawlLogRef.current.scrollHeight, behavior: "smooth" }), 50);

      try {
        const res = await fetch("/api/companies/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyIds: [company.id] }),
        });
        const data = await res.json();
        const r = data.results?.[0];
        if (r?.status === "completed") {
          setCrawlLog((prev) =>
            prev.map((e) =>
              e.companyName === company.name && e.status === "crawling"
                ? { ...e, status: "completed", jobsFound: r.matchedJobs }
                : e
            )
          );
        } else {
          setCrawlLog((prev) =>
            prev.map((e) =>
              e.companyName === company.name && e.status === "crawling"
                ? { ...e, status: "failed", error: r?.error || "Unknown error" }
                : e
            )
          );
        }
      } catch {
        setCrawlLog((prev) =>
          prev.map((e) =>
            e.companyName === company.name && e.status === "crawling"
              ? { ...e, status: "failed", error: "Network error" }
              : e
          )
        );
      }
      setTimeout(() => crawlLogRef.current?.scrollTo({ top: crawlLogRef.current.scrollHeight, behavior: "smooth" }), 50);
    }

    setCrawlRunning(false);
    fetchCompanies();
  };

  const saveDiscoveredCompanies = async () => {
    if (discoveredCompanies.length === 0) return;

    setSavingCompanies(true);
    try {
      const payload: Record<string, unknown> = {
        companies: discoveredCompanies,
      };

      // Include prompt save if checked
      if (savePromptChecked) {
        payload.savePrompt = {
          name: promptName,
          conversation: chatMessages,
          preferences: {},
          schedule: promptSchedule,
        };
      }

      const res = await fetch("/api/discover", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setDiscoverySaved(true);
        fetchCompanies();

        // Kick off client-side crawl with visible log
        // Get the saved company IDs by refetching the companies list
        const companiesRes = await fetch("/api/companies");
        const companiesData = await companiesRes.json();
        if (companiesData.companies) {
          const savedNames = new Set(discoveredCompanies.map((c) => c.name as string));
          const toCrawl = (companiesData.companies as TargetCompany[])
            .filter((c) => savedNames.has(c.name) && c.careers_url)
            .map((c) => ({ id: c.id, name: c.name }));
          if (toCrawl.length > 0) {
            crawlCompaniesWithLog(toCrawl);
          }
        }
      } else {
        toast.error(data.error || "Failed to save companies");
      }
    } catch {
      toast.error("Failed to save companies");
    }
    setSavingCompanies(false);
  };

  const addCompany = async () => {
    if (!newName.trim()) return;

    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          name: newName.trim(),
          careersUrl: newCareersUrl.trim() || undefined,
          industry: newIndustry.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success(`Added ${newName}`);
        setNewName("");
        setNewCareersUrl("");
        setNewIndustry("");
        setShowAdd(false);
        fetchCompanies();
      }
    } catch {
      toast.error("Failed to add company");
    }
  };

  const toggleCompany = async (id: string, enabled: boolean) => {
    await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", companyId: id, enabled }),
    });
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled } : c))
    );
  };

  const watchCompany = async (id: string, watched: boolean) => {
    await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "watch", companyId: id, watched }),
    });
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, watched } : c))
    );
  };

  const deleteCompany = async (id: string) => {
    await fetch("/api/companies", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: id }),
    });
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  };

  const scanCompany = async (id: string, extraContext?: string) => {
    // Mark as crawling in UI immediately
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, crawl_status: "crawling" } : c
      )
    );
    // Clear any needs-info state
    if (needsInfoCompanyId === id) {
      setNeedsInfoCompanyId(null);
      setNeedsInfoPrompt("");
      setNeedsInfoInput("");
    }
    try {
      const res = await fetch("/api/companies/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds: [id], extraContext }),
      });
      const data = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0];
        setCompanies((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  crawl_status: r.status,
                  crawl_error: r.error || null,
                  matched_jobs_count: r.matchedJobs,
                  jobs_found: r.jobsFound,
                  last_crawled_at: new Date().toISOString(),
                  avg_match_confidence:
                    r.status === "completed" && r.jobsFound > 0
                      ? Math.round((r.matchedJobs / r.jobsFound) * 100) / 100
                      : null,
                }
              : c
          )
        );
        // If agent needs more info, show the prompt
        if (r.needsInfo) {
          setNeedsInfoCompanyId(id);
          setNeedsInfoPrompt(r.needsInfo);
          toast.info("The agent needs more information to match jobs at this company");
        } else if (r.status === "completed") {
          toast.success(`Found ${r.matchedJobs} matching jobs at this company`);
        } else {
          toast.error(r.error || "Scan failed");
        }
      }
      // Refresh to get accurate data from DB
      fetchCompanies();
    } catch {
      toast.error("Failed to scan company");
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, crawl_status: "failed" } : c
        )
      );
    }
  };

  // Filter and group
  const filtered = companies.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.industry || "").toLowerCase().includes(search.toLowerCase())
  );

  const grouped: Record<string, TargetCompany[]> = {};
  for (const tier of TIER_ORDER) {
    grouped[tier] = filtered.filter((c) => c.distance_tier === tier);
  }
  // Add ungrouped
  const ungrouped = filtered.filter(
    (c) => !c.distance_tier || !TIER_ORDER.includes(c.distance_tier)
  );
  if (ungrouped.length > 0) {
    grouped["other"] = ungrouped;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6" />
            Target Companies
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {companies.length} companies tracked
            {" | "}
            {companies.filter((c) => c.enabled).length} enabled
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm w-48 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
          </div>

          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>

          <button
            onClick={openDiscovery}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Sparkles className="w-4 h-4" />
            Discover Companies
          </button>
        </div>
      </div>

      {/* Add company form */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 shadow-sm">
          <h3 className="text-sm font-semibold mb-3">Add Company Manually</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Company name"
                className="w-full px-3 py-1.5 border rounded-lg text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Careers URL</label>
              <input
                type="text"
                value={newCareersUrl}
                onChange={(e) => setNewCareersUrl(e.target.value)}
                placeholder="https://company.com/careers"
                className="w-full px-3 py-1.5 border rounded-lg text-sm"
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-gray-500 mb-1">Industry</label>
              <input
                type="text"
                value={newIndustry}
                onChange={(e) => setNewIndustry(e.target.value)}
                placeholder="e.g. Fintech"
                className="w-full px-3 py-1.5 border rounded-lg text-sm"
              />
            </div>
            <button
              onClick={addCompany}
              disabled={!newName.trim()}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Company groups by tier */}
      {Object.entries(grouped).map(([tier, tierCompanies]) => {
        if (tierCompanies.length === 0) return null;

        const tierLabel =
          tier === "local" ? "Local" :
          tier === "regional" ? "Regional" :
          tier === "national" ? "National" :
          tier === "remote" ? "Remote-First" : "Other";

        return (
          <div key={tier} className="mb-6">
            <h2 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs ${TIER_COLORS[tier] || "bg-gray-100 text-gray-600"}`}>
                {tierLabel}
              </span>
              <span className="text-gray-400">{tierCompanies.length} companies</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {tierCompanies.map((company) => (
                <div
                  key={company.id}
                  className={`group rounded-xl border bg-white p-4 shadow-sm hover:shadow-md transition-all ${
                    company.enabled ? "border-gray-200" : "border-gray-100 opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-medium text-sm text-gray-900 truncate">
                          {company.name}
                        </h3>
                        {company.last_crawled_at && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">
                            <ScanSearch className="w-2.5 h-2.5" />
                            Searched
                          </span>
                        )}
                        {company.watched && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700">
                            <Eye className="w-2.5 h-2.5" />
                            Watched
                          </span>
                        )}
                      </div>
                      {company.industry && (
                        <p className="text-xs text-gray-500 mt-0.5">{company.industry}</p>
                      )}
                      {company.location && (
                        <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {company.location}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {company.ats_type && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {company.ats_type}
                        </span>
                      )}
                      <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                        P{company.priority}
                      </span>
                    </div>
                  </div>

                  {/* Job matches badge */}
                  {company.crawl_status === "crawling" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg px-2.5 py-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Scanning careers page...
                    </div>
                  )}
                  {company.crawl_status === "completed" && (company.matched_jobs_count ?? 0) > 0 && (
                    <div className="mt-2 flex items-center justify-between bg-amber-50 rounded-lg px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                        <Briefcase className="w-3.5 h-3.5" />
                        {company.matched_jobs_count} possible job match{company.matched_jobs_count !== 1 ? "es" : ""}
                      </div>
                      {company.avg_match_confidence != null && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          company.avg_match_confidence >= 0.7
                            ? "bg-green-100 text-green-700"
                            : company.avg_match_confidence >= 0.4
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-700"
                        }`}>
                          {Math.round(company.avg_match_confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                  )}
                  {company.crawl_status === "completed" && (company.matched_jobs_count ?? 0) === 0 && (
                    <div className="mt-2 text-xs text-gray-400 italic">
                      No matching jobs found
                    </div>
                  )}
                  {company.crawl_status === "failed" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500 bg-red-50 rounded-lg px-2.5 py-1.5">
                      <AlertCircle className="w-3 h-3" />
                      {company.crawl_error?.startsWith("Needs info:")
                        ? company.crawl_error.replace("Needs info: ", "")
                        : "Scan failed"}
                    </div>
                  )}
                  {needsInfoCompanyId === company.id && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <p className="text-xs text-amber-800 font-medium mb-1.5 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        Agent needs more info:
                      </p>
                      <p className="text-xs text-amber-700 mb-2">{needsInfoPrompt}</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (needsInfoInput.trim()) {
                            scanCompany(company.id, needsInfoInput.trim());
                          }
                        }}
                        className="flex gap-1.5"
                      >
                        <input
                          type="text"
                          value={needsInfoInput}
                          onChange={(e) => setNeedsInfoInput(e.target.value)}
                          placeholder="Provide the info..."
                          className="flex-1 px-2.5 py-1.5 border border-amber-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-200 focus:outline-none"
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={!needsInfoInput.trim()}
                          className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                        >
                          Rescan
                        </button>
                      </form>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {company.jobs_found > 0 && (
                        <span>{company.jobs_found} jobs found</span>
                      )}
                      {company.discovery_source && (
                        <span className="capitalize">{company.discovery_source.replace("_", " ")}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {company.careers_url && company.crawl_status !== "crawling" && (
                        <button
                          onClick={() => scanCompany(company.id)}
                          className="p-1 rounded hover:bg-blue-50"
                          title="Scan for matching jobs"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
                        </button>
                      )}
                      <button
                        onClick={() => watchCompany(company.id, !company.watched)}
                        className="p-1 rounded hover:bg-violet-50"
                        title={company.watched ? "Stop watching" : "Watch — include in scheduled searches"}
                      >
                        {company.watched ? (
                          <Eye className="w-4 h-4 text-violet-500" />
                        ) : (
                          <EyeOff className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      {company.careers_url && (
                        <a
                          href={company.careers_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-gray-100"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                        </a>
                      )}
                      <button
                        onClick={() => toggleCompany(company.id, !company.enabled)}
                        className="p-1 rounded hover:bg-gray-100"
                      >
                        {company.enabled ? (
                          <ToggleRight className="w-4 h-4 text-green-500" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => deleteCompany(company.id)}
                        className="p-1 rounded hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {companies.length === 0 && (
        <div className="text-center py-16">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600">No target companies yet</h3>
          <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
            Click &quot;Discover Companies&quot; to let AI analyze your resume and suggest
            companies that would be a good fit, or add companies manually.
          </p>
        </div>
      )}

      {/* Discovery Chat Modal */}
      {showDiscovery && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Company Discovery</h2>
              </div>
              <button
                onClick={() => setShowDiscovery(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Info banner */}
            <div className="px-6 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>You can close this window anytime — your jobs will appear in the <a href="/jobs" className="font-semibold underline hover:text-blue-900">Job Pipeline</a>.</span>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="whitespace-pre-wrap">{msg.content}
                        {streaming && i === chatMessages.length - 1 && (
                          <span className="inline-block w-1.5 h-4 bg-blue-500 ml-0.5 animate-pulse rounded-sm" />
                        )}
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}

              {/* Discovered companies preview */}
              {discoveredCompanies.length > 0 && !discoverySaved && (
                <div className="bg-green-50 rounded-xl border border-green-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <h3 className="font-semibold text-green-800">
                      {discoveredCompanies.length} Companies Found
                    </h3>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {discoveredCompanies.map((c, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm"
                      >
                        <div>
                          <span className="font-medium text-gray-900">{c.name as string}</span>
                          {c.industry ? (
                            <span className="text-gray-400 ml-2">
                              {String(c.industry)}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {c.location ? (
                            <span className="text-xs text-gray-400">
                              {String(c.location)}
                            </span>
                          ) : null}
                          {c.distance_tier ? (
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                TIER_COLORS[c.distance_tier as string] || "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {String(c.distance_tier)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Save for scheduled searches option */}
                  <div className="mt-4 pt-3 border-t border-green-200">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={savePromptChecked}
                        onChange={(e) => setSavePromptChecked(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-800">
                          Save for scheduled agent searches
                        </span>
                        <p className="text-xs text-gray-500 mt-0.5">
                          The agent will use this discovery profile to find new companies on a recurring schedule.
                        </p>
                      </div>
                    </label>
                    {savePromptChecked && (
                      <div className="mt-2 ml-7 flex gap-2">
                        <input
                          type="text"
                          value={promptName}
                          onChange={(e) => setPromptName(e.target.value)}
                          placeholder="Name this search"
                          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-200 focus:outline-none"
                        />
                        <select
                          value={promptSchedule}
                          onChange={(e) => setPromptSchedule(e.target.value)}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-200 focus:outline-none bg-white"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Biweekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={saveDiscoveredCompanies}
                    disabled={savingCompanies}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {savingCompanies ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    Save {discoveredCompanies.length} Companies
                  </button>
                </div>
              )}

              {/* Post-save confirmation + crawl log */}
              {discoverySaved && (
                <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
                  <div className="text-center mb-4">
                    <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Discovery Complete!
                    </h3>
                    <p className="text-sm text-gray-600 mb-1">
                      {discoveredCompanies.length} companies have been added to your target list.
                    </p>
                    {savePromptChecked && (
                      <p className="text-xs text-blue-600">
                        Search saved — the agent will run this discovery {promptSchedule}.
                      </p>
                    )}
                  </div>

                  {/* Crawl activity log */}
                  {(crawlRunning || crawlLog.length > 0) && (
                    <div className="bg-gray-900 rounded-lg p-4 mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        {crawlRunning ? (
                          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        )}
                        <span className="text-sm font-medium text-gray-200">
                          {crawlRunning
                            ? `Discovering jobs... (${crawlLog.filter((e) => e.status !== "crawling").length}/${crawlLog.length})`
                            : `Scan complete — ${crawlLog.filter((e) => e.status === "completed").length} of ${crawlLog.length} companies scanned`}
                        </span>
                      </div>
                      <div
                        ref={crawlLogRef}
                        className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs"
                      >
                        {crawlLog.map((entry, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {entry.status === "crawling" && (
                              <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
                            )}
                            {entry.status === "completed" && (
                              <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                            )}
                            {entry.status === "failed" && (
                              <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                            )}
                            <span className={
                              entry.status === "crawling"
                                ? "text-blue-300"
                                : entry.status === "completed"
                                ? "text-green-300"
                                : "text-red-300"
                            }>
                              {entry.companyName}
                            </span>
                            {entry.status === "crawling" && (
                              <span className="text-gray-500">scanning careers page...</span>
                            )}
                            {entry.status === "completed" && (
                              <span className="text-gray-400">
                                — {entry.jobsFound} job{entry.jobsFound !== 1 ? "s" : ""} matched
                              </span>
                            )}
                            {entry.status === "failed" && (
                              <span className="text-red-400/70">
                                — {entry.error}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      {!crawlRunning && crawlLog.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-gray-700 text-xs text-gray-400">
                          Total: {crawlLog.reduce((sum, e) => sum + (e.jobsFound || 0), 0)} jobs found across {crawlLog.filter((e) => e.status === "completed").length} companies
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 justify-center">
                    <a
                      href="/jobs"
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Go to Job Pipeline
                    </a>
                    <button
                      onClick={() => setShowDiscovery(false)}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Action buttons / Input */}
            <div className="px-6 py-4 border-t border-gray-100 space-y-3">
              {discoveredCompanies.length === 0 && !discoverySaved && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                  className="flex gap-2"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={readyToDiscover ? "Add more details, or click Begin Discovery..." : "Type your response..."}
                    disabled={streaming}
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none disabled:opacity-50"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || streaming}
                    className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {streaming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              )}

              {readyToDiscover && discoveredCompanies.length === 0 && !discoverySaved && (
                <button
                  onClick={generateCompanyList}
                  disabled={streaming}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 shadow-lg shadow-blue-200 transition-all"
                >
                  {streaming ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Discovering companies...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Begin Discovery
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Persistent floating crawl activity bar (visible when modal is closed but crawl is running) */}
      {!showDiscovery && (crawlRunning || crawlLog.length > 0) && (
        <div className="fixed bottom-0 left-16 right-0 bg-gray-900 border-t border-gray-700 shadow-2xl z-40">
          <div className="max-w-6xl mx-auto px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {crawlRunning ? (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                )}
                <span className="text-sm font-medium text-gray-200">
                  {crawlRunning
                    ? `Discovering jobs... (${crawlLog.filter((e) => e.status !== "crawling").length}/${crawlLog.length})`
                    : `Scan complete — ${crawlLog.reduce((sum, e) => sum + (e.jobsFound || 0), 0)} jobs found`}
                </span>
              </div>
              {!crawlRunning && (
                <button
                  onClick={() => setCrawlLog([])}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Dismiss
                </button>
              )}
            </div>
            <div className="flex gap-3 overflow-x-auto font-mono text-xs pb-1">
              {crawlLog.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {entry.status === "crawling" && (
                    <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                  )}
                  {entry.status === "completed" && (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  )}
                  {entry.status === "failed" && (
                    <AlertCircle className="w-3 h-3 text-red-400" />
                  )}
                  <span className={
                    entry.status === "crawling"
                      ? "text-blue-300"
                      : entry.status === "completed"
                      ? "text-green-300"
                      : "text-red-300"
                  }>
                    {entry.companyName}
                    {entry.status === "completed" && ` (${entry.jobsFound})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
