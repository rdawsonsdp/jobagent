"use client";

import { useEffect, useState } from "react";
import { Settings2, Save } from "lucide-react";
import { toast } from "sonner";

export default function ConfigPage() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/email-agent/config")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.config || {});
        setLoading(false);
      });
  }, []);

  const updateField = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const saveAll = async () => {
    setSaving(true);
    const res = await fetch("/api/email-agent/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Configuration saved");
    } else {
      toast.error("Failed to save configuration");
    }
  };

  if (loading) return <div className="p-6">Loading config...</div>;

  const hours = typeof config.hours === "object" ? config.hours as Record<string, string> : {};
  const contact = typeof config.contact === "object" ? config.contact as Record<string, string> : {};

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings2 className="w-6 h-6" /> Bakery Configuration
        </h1>
        <button
          onClick={saveAll}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save All"}
        </button>
      </div>

      <p className="text-gray-500 text-sm">
        This information is included in every AI-generated response. Keep it
        accurate and up to date.
      </p>

      {/* Bakery Name */}
      <Section title="Bakery Name">
        <input
          type="text"
          value={(config.bakery_name as string) || ""}
          onChange={(e) => updateField("bakery_name", e.target.value)}
          className="w-full border rounded-lg p-2"
          placeholder="Your Bakery Name"
        />
      </Section>

      {/* Contact Info */}
      <Section title="Contact Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500">Phone</label>
            <input
              type="text"
              value={contact.phone || ""}
              onChange={(e) =>
                updateField("contact", { ...contact, phone: e.target.value })
              }
              className="w-full border rounded-lg p-2"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Email</label>
            <input
              type="email"
              value={contact.email || ""}
              onChange={(e) =>
                updateField("contact", { ...contact, email: e.target.value })
              }
              className="w-full border rounded-lg p-2"
              placeholder="info@bakery.com"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Address</label>
            <input
              type="text"
              value={contact.address || ""}
              onChange={(e) =>
                updateField("contact", { ...contact, address: e.target.value })
              }
              className="w-full border rounded-lg p-2"
              placeholder="123 Main St"
            />
          </div>
        </div>
      </Section>

      {/* Business Hours */}
      <Section title="Business Hours">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
            (day) => (
              <div key={day} className="flex items-center gap-2">
                <label className="text-sm capitalize w-24">{day}</label>
                <input
                  type="text"
                  value={hours[day] || ""}
                  onChange={(e) =>
                    updateField("hours", { ...hours, [day]: e.target.value })
                  }
                  className="flex-1 border rounded-lg p-2 text-sm"
                  placeholder="7am-6pm or closed"
                />
              </div>
            )
          )}
        </div>
      </Section>

      {/* Policies */}
      <Section title="Ordering Process">
        <textarea
          value={(config.ordering_process as string) || ""}
          onChange={(e) => updateField("ordering_process", e.target.value)}
          className="w-full border rounded-lg p-2 h-24 text-sm"
          placeholder="Describe how customers can place orders..."
        />
      </Section>

      <Section title="Delivery Policy">
        <textarea
          value={(config.delivery_policy as string) || ""}
          onChange={(e) => updateField("delivery_policy", e.target.value)}
          className="w-full border rounded-lg p-2 h-24 text-sm"
          placeholder="Delivery areas, fees, minimum orders..."
        />
      </Section>

      <Section title="Cancellation Policy">
        <textarea
          value={(config.cancellation_policy as string) || ""}
          onChange={(e) => updateField("cancellation_policy", e.target.value)}
          className="w-full border rounded-lg p-2 h-24 text-sm"
          placeholder="Cancellation timeframes and refund policy..."
        />
      </Section>

      <Section title="Allergen Information">
        <textarea
          value={(config.allergen_info as string) || ""}
          onChange={(e) => updateField("allergen_info", e.target.value)}
          className="w-full border rounded-lg p-2 h-24 text-sm"
          placeholder="Common allergens, cross-contamination info..."
        />
      </Section>

      {/* Agent Settings */}
      <Section title="Agent Settings">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Auto-Reply Enabled</p>
              <p className="text-xs text-gray-500">
                Master switch for automatic email responses
              </p>
            </div>
            <button
              onClick={() =>
                updateField("auto_reply_enabled", !config.auto_reply_enabled)
              }
              className={`px-4 py-1.5 rounded-lg text-sm font-medium ${
                config.auto_reply_enabled
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {config.auto_reply_enabled ? "ON" : "OFF"}
            </button>
          </div>

          <div>
            <label className="text-sm font-medium">
              Max Auto-Replies Per Hour
            </label>
            <input
              type="number"
              value={(config.max_auto_replies_per_hour as number) || 50}
              onChange={(e) =>
                updateField("max_auto_replies_per_hour", parseInt(e.target.value))
              }
              className="w-32 border rounded-lg p-2 text-sm ml-3"
              min={0}
              max={200}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Escalation Keywords</label>
            <p className="text-xs text-gray-500 mb-1">
              Emails containing these words are always escalated to a human (comma-separated)
            </p>
            <textarea
              value={
                Array.isArray(config.escalation_keywords)
                  ? (config.escalation_keywords as string[]).join(", ")
                  : ""
              }
              onChange={(e) =>
                updateField(
                  "escalation_keywords",
                  e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean)
                )
              }
              className="w-full border rounded-lg p-2 text-sm h-16"
              placeholder="lawyer, health department, allergic reaction..."
            />
          </div>
        </div>
      </Section>

      <div className="pb-8">
        <button
          onClick={saveAll}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save All Changes"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-lg p-4">
      <h2 className="font-bold mb-3">{title}</h2>
      {children}
    </div>
  );
}
