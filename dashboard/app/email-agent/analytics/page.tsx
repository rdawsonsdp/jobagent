"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";

interface Analytics {
  overview: { total_emails: number; today: number; this_week: number };
  actions: { total: number; auto_replied: number; drafted: number; escalated: number };
  rates: { auto_reply_rate: number; human_edit_rate: number };
  category_breakdown: Record<string, number>;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/email-agent/analytics")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading || !data) {
    return <div className="p-6">Loading analytics...</div>;
  }

  const maxCategoryCount = Math.max(...Object.values(data.category_breakdown), 1);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="w-6 h-6" /> Analytics
      </h1>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Emails" value={data.overview.total_emails} />
        <MetricCard label="Today" value={data.overview.today} />
        <MetricCard label="This Week" value={data.overview.this_week} />
        <MetricCard label="Total Actions" value={data.actions.total} />
      </div>

      {/* Action Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4">
          <h2 className="font-bold mb-4">Action Breakdown</h2>
          <div className="space-y-3">
            <ActionBar
              label="Auto-Replied"
              count={data.actions.auto_replied}
              total={data.actions.total}
              color="bg-green-500"
            />
            <ActionBar
              label="Drafted for Review"
              count={data.actions.drafted}
              total={data.actions.total}
              color="bg-yellow-500"
            />
            <ActionBar
              label="Escalated"
              count={data.actions.escalated}
              total={data.actions.total}
              color="bg-red-500"
            />
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="font-bold mb-4">Performance</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Auto-Reply Rate</span>
                <span className="font-bold">{data.rates.auto_reply_rate}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full">
                <div
                  className="h-3 bg-green-500 rounded-full"
                  style={{ width: `${data.rates.auto_reply_rate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Human Edit Rate</span>
                <span className="font-bold">{data.rates.human_edit_rate}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full">
                <div
                  className="h-3 bg-blue-500 rounded-full"
                  style={{ width: `${data.rates.human_edit_rate}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Lower is better - means AI drafts need fewer edits
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="border rounded-lg p-4">
        <h2 className="font-bold mb-4">Emails by Category</h2>
        <div className="space-y-2">
          {Object.entries(data.category_breakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([category, count]) => (
              <div key={category} className="flex items-center gap-3">
                <span className="text-sm w-32 text-gray-600 capitalize">
                  {category.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-6 bg-gray-100 rounded">
                  <div
                    className="h-6 bg-blue-500 rounded flex items-center px-2"
                    style={{
                      width: `${(count / maxCategoryCount) * 100}%`,
                      minWidth: "2rem",
                    }}
                  >
                    <span className="text-xs text-white font-medium">{count}</span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}

function ActionBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-medium">
          {count} ({Math.round(pct)}%)
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full">
        <div
          className={`h-2 ${color} rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
