"use client";

import { useEffect, useState } from "react";
import { FolderOpen, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface Category {
  id: string;
  name: string;
  display_name: string;
  description: string;
  auto_reply_enabled: boolean;
  confidence_threshold: number;
  example_count: number;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/email-agent/categories")
      .then((r) => r.json())
      .then((data) => {
        setCategories(data.categories || []);
        setLoading(false);
      });
  }, []);

  const toggleAutoReply = async (cat: Category) => {
    const res = await fetch("/api/email-agent/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cat.id,
        auto_reply_enabled: !cat.auto_reply_enabled,
      }),
    });

    if (res.ok) {
      setCategories((prev) =>
        prev.map((c) =>
          c.id === cat.id ? { ...c, auto_reply_enabled: !c.auto_reply_enabled } : c
        )
      );
      toast.success(
        `Auto-reply ${!cat.auto_reply_enabled ? "enabled" : "disabled"} for ${cat.display_name}`
      );
    }
  };

  const updateThreshold = async (cat: Category, threshold: number) => {
    const res = await fetch("/api/email-agent/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cat.id,
        confidence_threshold: threshold,
      }),
    });

    if (res.ok) {
      setCategories((prev) =>
        prev.map((c) =>
          c.id === cat.id ? { ...c, confidence_threshold: threshold } : c
        )
      );
    }
  };

  if (loading) {
    return <div className="p-6">Loading categories...</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <FolderOpen className="w-6 h-6" /> Email Categories
      </h1>
      <p className="text-gray-500 text-sm">
        Manage how different types of emails are handled. Toggle auto-reply and
        set confidence thresholds per category.
      </p>

      <div className="grid gap-4">
        {categories.map((cat) => (
          <div key={cat.id} className="border rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold">{cat.display_name}</h3>
                <p className="text-sm text-gray-500">{cat.description}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {cat.example_count} training examples
                </p>
              </div>
              <button
                onClick={() => toggleAutoReply(cat)}
                className="flex items-center gap-2"
              >
                {cat.auto_reply_enabled ? (
                  <ToggleRight className="w-8 h-8 text-green-500" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-gray-300" />
                )}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-4">
              <label className="text-sm text-gray-600">
                Confidence threshold:
              </label>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.05"
                value={cat.confidence_threshold}
                onChange={(e) =>
                  updateThreshold(cat, parseFloat(e.target.value))
                }
                className="flex-1 max-w-xs"
              />
              <span className="text-sm font-mono w-12 text-right">
                {Math.round(cat.confidence_threshold * 100)}%
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div
                className={`h-2 rounded-full flex-1 max-w-xs ${
                  cat.auto_reply_enabled ? "bg-green-100" : "bg-gray-100"
                }`}
              >
                <div
                  className={`h-2 rounded-full ${
                    cat.auto_reply_enabled ? "bg-green-500" : "bg-gray-300"
                  }`}
                  style={{
                    width: `${cat.confidence_threshold * 100}%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-400">
                {cat.auto_reply_enabled ? "Auto-reply ON" : "Draft only"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
