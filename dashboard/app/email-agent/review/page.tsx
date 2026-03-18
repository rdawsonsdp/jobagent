"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  X,
  Pencil,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Send,
} from "lucide-react";
import { toast } from "sonner";

interface EmailAction {
  id: string;
  action: string;
  category: string;
  confidence: number;
  draft_response: string;
  final_response: string | null;
  status: string;
  created_at: string;
  bakery_emails: {
    id: string;
    from_address: string;
    subject: string;
    body_text: string;
    received_at: string;
  };
}

export default function ReviewPage() {
  const [actions, setActions] = useState<EmailAction[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchActions = useCallback(async () => {
    const res = await fetch("/api/email-agent/actions?status=pending&limit=50");
    const data = await res.json();
    setActions(data.actions || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const current = actions[currentIndex];

  const handleAction = async (
    status: "approved" | "edited" | "rejected",
    finalResponse?: string
  ) => {
    if (!current) return;

    const body: Record<string, string> = { id: current.id, status };
    if (finalResponse) body.final_response = finalResponse;

    const res = await fetch("/api/email-agent/actions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      toast.success(
        status === "approved"
          ? "Response approved and queued for sending"
          : status === "edited"
          ? "Edited response saved and queued"
          : "Response rejected"
      );
      setActions((prev) => prev.filter((_, i) => i !== currentIndex));
      setCurrentIndex((prev) => Math.min(prev, actions.length - 2));
      setEditMode(false);
    } else {
      toast.error("Failed to update action");
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editMode) return;
      if (e.key === "j" || e.key === "ArrowDown")
        setCurrentIndex((i) => Math.min(i + 1, actions.length - 1));
      if (e.key === "k" || e.key === "ArrowUp")
        setCurrentIndex((i) => Math.max(i - 1, 0));
      if (e.key === "a") handleAction("approved");
      if (e.key === "e") {
        setEditText(current?.draft_response || "");
        setEditMode(true);
      }
      if (e.key === "r") handleAction("rejected");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse h-8 bg-gray-200 rounded w-48" />
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="p-6 text-center py-20">
        <Check className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold">All caught up!</h2>
        <p className="text-gray-500 mt-2">No emails pending review.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review Drafts</h1>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>
            {currentIndex + 1} of {actions.length}
          </span>
          <button
            onClick={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
            disabled={currentIndex === 0}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              setCurrentIndex((i) => Math.min(i + 1, actions.length - 1))
            }
            disabled={currentIndex === actions.length - 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-400">
        Shortcuts: <kbd className="px-1 border rounded">j</kbd>/<kbd className="px-1 border rounded">k</kbd> navigate, <kbd className="px-1 border rounded">a</kbd> approve, <kbd className="px-1 border rounded">e</kbd> edit, <kbd className="px-1 border rounded">r</kbd> reject
      </div>

      {current && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Customer Email */}
          <div className="border rounded-lg">
            <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
              <span className="font-medium">Customer Email</span>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  {current.category}
                </span>
                {current.action === "escalated" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Escalated
                  </span>
                )}
              </div>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-sm text-gray-500">
                From: {current.bakery_emails?.from_address}
              </p>
              <p className="font-medium">
                {current.bakery_emails?.subject || "No subject"}
              </p>
              <div className="text-sm whitespace-pre-wrap mt-3 bg-gray-50 p-3 rounded">
                {current.bakery_emails?.body_text}
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                <span>
                  Confidence: {Math.round(current.confidence * 100)}%
                </span>
                <span>|</span>
                <span>
                  {new Date(current.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* AI Draft Response */}
          <div className="border rounded-lg">
            <div className="p-3 border-b bg-green-50">
              <span className="font-medium">AI Draft Response</span>
            </div>
            <div className="p-4">
              {editMode ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full h-64 border rounded p-3 text-sm font-mono"
                  autoFocus
                />
              ) : (
                <div className="text-sm whitespace-pre-wrap bg-green-50 p-3 rounded min-h-[200px]">
                  {current.draft_response}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                {editMode ? (
                  <>
                    <button
                      onClick={() => handleAction("edited", editText)}
                      className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                    >
                      <Send className="w-4 h-4" /> Save & Send
                    </button>
                    <button
                      onClick={() => setEditMode(false)}
                      className="px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleAction("approved")}
                      className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                    >
                      <Check className="w-4 h-4" /> Approve
                    </button>
                    <button
                      onClick={() => {
                        setEditText(current.draft_response);
                        setEditMode(true);
                      }}
                      className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                    >
                      <Pencil className="w-4 h-4" /> Edit
                    </button>
                    <button
                      onClick={() => handleAction("rejected")}
                      className="flex items-center gap-1 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Queue list */}
      <div className="border rounded-lg">
        <div className="p-3 border-b bg-gray-50 font-medium text-sm">
          Review Queue ({actions.length})
        </div>
        <div className="divide-y max-h-64 overflow-y-auto">
          {actions.map((action, i) => (
            <button
              key={action.id}
              onClick={() => setCurrentIndex(i)}
              className={`w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between ${
                i === currentIndex ? "bg-blue-50 border-l-2 border-blue-500" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {action.bakery_emails?.subject || "No subject"}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {action.bakery_emails?.from_address}
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 ml-2">
                {action.category}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
