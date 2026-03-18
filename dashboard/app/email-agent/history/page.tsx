"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Send, Pencil, XCircle } from "lucide-react";

interface HistoryAction {
  id: string;
  action: string;
  category: string;
  confidence: number;
  draft_response: string;
  final_response: string;
  status: string;
  sent_at: string;
  reviewed_at: string;
  created_at: string;
  bakery_emails: {
    from_address: string;
    subject: string;
    body_text: string;
  };
}

export default function HistoryPage() {
  const [actions, setActions] = useState<HistoryAction[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (filter === "auto_replied") params.set("action", "auto_replied");
    if (filter === "sent") params.set("status", "sent");
    if (filter === "rejected") params.set("status", "rejected");

    fetch(`/api/email-agent/actions?${params}`)
      .then((r) => r.json())
      .then((data) => {
        const sentActions = (data.actions || []).filter(
          (a: HistoryAction) => a.status === "sent" || a.status === "rejected" || a.status === "edited"
        );
        setActions(sentActions);
        setLoading(false);
      });
  }, [filter]);

  const statusIcon = (status: string) => {
    switch (status) {
      case "sent":
        return <Send className="w-4 h-4 text-green-500" />;
      case "edited":
        return <Pencil className="w-4 h-4 text-blue-500" />;
      case "rejected":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <CheckCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Sent History</h1>

      <div className="flex gap-2">
        {["all", "auto_replied", "sent", "rejected"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg capitalize ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : actions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No history yet. Responses will appear here after they are sent.
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {actions.map((action) => (
            <div key={action.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {statusIcon(action.status)}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {action.bakery_emails?.subject || "No subject"}
                    </p>
                    <p className="text-xs text-gray-500">
                      To: {action.bakery_emails?.from_address}
                    </p>
                    <div className="mt-2 text-sm text-gray-700 bg-gray-50 p-3 rounded whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {action.final_response || action.draft_response}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 ml-4 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    {action.category}
                  </span>
                  <span className="text-xs text-gray-400">
                    {action.sent_at
                      ? new Date(action.sent_at).toLocaleDateString()
                      : new Date(action.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-400">
                    {Math.round(action.confidence * 100)}% confidence
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
