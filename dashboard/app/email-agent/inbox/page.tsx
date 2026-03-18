"use client";

import { useEffect, useState } from "react";
import { Mail, ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";

interface Email {
  id: string;
  from_address: string;
  to_address: string;
  subject: string;
  body_text: string;
  direction: "inbound" | "outbound";
  received_at: string;
  is_processed: boolean;
  bakery_email_actions: Array<{
    action: string;
    category: string;
    confidence: number;
    status: string;
  }>;
}

export default function InboxPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selected, setSelected] = useState<Email | null>(null);
  const [filter, setFilter] = useState<"all" | "inbound" | "outbound">("inbound");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (filter !== "all") params.set("direction", filter);

    fetch(`/api/email-agent/emails?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEmails(data.emails || []);
        setLoading(false);
      });
  }, [filter]);

  const filtered = emails.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.subject?.toLowerCase().includes(q) ||
      e.from_address?.toLowerCase().includes(q) ||
      e.body_text?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Mail className="w-6 h-6" /> Inbox
      </h1>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
          />
        </div>
        <div className="flex border rounded-lg overflow-hidden">
          {(["inbound", "outbound", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-sm capitalize ${
                filter === f ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Email List */}
        <div className="border rounded-lg divide-y max-h-[calc(100vh-220px)] overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No emails found</div>
          ) : (
            filtered.map((email) => (
              <button
                key={email.id}
                onClick={() => setSelected(email)}
                className={`w-full text-left p-3 hover:bg-gray-50 ${
                  selected?.id === email.id ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  {email.direction === "inbound" ? (
                    <ArrowDownLeft className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {email.subject || "No subject"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {email.from_address}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">
                        {new Date(email.received_at).toLocaleDateString()}
                      </span>
                      {email.bakery_email_actions?.[0] && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          {email.bakery_email_actions[0].category}
                        </span>
                      )}
                      {email.is_processed && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          Processed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Email Detail */}
        <div className="border rounded-lg">
          {selected ? (
            <div className="p-4 space-y-3">
              <h2 className="font-bold text-lg">{selected.subject || "No subject"}</h2>
              <div className="text-sm text-gray-500 space-y-1">
                <p>From: {selected.from_address}</p>
                <p>To: {selected.to_address}</p>
                <p>Date: {new Date(selected.received_at).toLocaleString()}</p>
              </div>
              {selected.bakery_email_actions?.[0] && (
                <div className="flex gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-blue-100 text-blue-700">
                    {selected.bakery_email_actions[0].category}
                  </span>
                  <span className="px-2 py-1 rounded bg-gray-100">
                    {selected.bakery_email_actions[0].action}
                  </span>
                  <span className="px-2 py-1 rounded bg-gray-100">
                    {Math.round(selected.bakery_email_actions[0].confidence * 100)}% confidence
                  </span>
                </div>
              )}
              <div className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg mt-4">
                {selected.body_text}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400">
              Select an email to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
