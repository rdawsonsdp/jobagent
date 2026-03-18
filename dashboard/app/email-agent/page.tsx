"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Mail,
  CheckCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  Send,
  FileEdit,
  BarChart3,
  Settings2,
  FolderOpen,
  Inbox,
} from "lucide-react";

interface Analytics {
  overview: { total_emails: number; today: number; this_week: number };
  actions: { total: number; auto_replied: number; drafted: number; escalated: number };
  rates: { auto_reply_rate: number; human_edit_rate: number };
  category_breakdown: Record<string, number>;
}

interface PendingAction {
  id: string;
  action: string;
  category: string;
  confidence: number;
  draft_response: string;
  created_at: string;
  bakery_emails: {
    from_address: string;
    subject: string;
    body_text: string;
  };
}

export default function EmailAgentDashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/email-agent/analytics").then((r) => r.json()),
      fetch("/api/email-agent/actions?status=pending&limit=5").then((r) => r.json()),
    ]).then(([analyticsData, actionsData]) => {
      setAnalytics(analyticsData);
      setPendingActions(actionsData.actions || []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const stats = analytics;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6" />
            Email Agent
          </h1>
          <p className="text-gray-500 mt-1">
            AI-powered email responses for your bakery
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Inbox className="w-5 h-5 text-blue-500" />}
          label="Emails Today"
          value={stats?.overview.today ?? 0}
        />
        <StatCard
          icon={<Send className="w-5 h-5 text-green-500" />}
          label="Auto-Replied"
          value={stats?.actions.auto_replied ?? 0}
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-yellow-500" />}
          label="Pending Review"
          value={pendingActions.length}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-purple-500" />}
          label="Auto-Reply Rate"
          value={`${stats?.rates.auto_reply_rate ?? 0}%`}
        />
      </div>

      {/* Quick Nav */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <NavCard href="/email-agent/review" icon={<FileEdit className="w-6 h-6" />} label="Review Drafts" description="Approve or edit AI-generated responses" count={pendingActions.length} />
        <NavCard href="/email-agent/inbox" icon={<Inbox className="w-6 h-6" />} label="Inbox" description="View all incoming emails with AI annotations" />
        <NavCard href="/email-agent/history" icon={<CheckCircle className="w-6 h-6" />} label="Sent History" description="Log of all sent responses" />
        <NavCard href="/email-agent/categories" icon={<FolderOpen className="w-6 h-6" />} label="Categories" description="Manage email categories and thresholds" />
        <NavCard href="/email-agent/analytics" icon={<BarChart3 className="w-6 h-6" />} label="Analytics" description="Response times, volumes, and accuracy" />
        <NavCard href="/email-agent/config" icon={<Settings2 className="w-6 h-6" />} label="Bakery Config" description="Hours, menu, policies for AI context" />
      </div>

      {/* Recent Pending Actions */}
      {pendingActions.length > 0 && (
        <div className="border rounded-lg">
          <div className="p-4 border-b bg-yellow-50 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <span className="font-medium text-yellow-800">Emails Needing Review</span>
          </div>
          <div className="divide-y">
            {pendingActions.map((action) => (
              <div key={action.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {action.bakery_emails?.subject || "No subject"}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      From: {action.bakery_emails?.from_address}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                      {action.category}
                    </span>
                    <span className="text-xs text-gray-500">
                      {Math.round(action.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t bg-gray-50 text-center">
            <Link
              href="/email-agent/review"
              className="text-sm text-blue-600 hover:underline"
            >
              Review all pending emails →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function NavCard({ href, icon, label, description, count }: { href: string; icon: React.ReactNode; label: string; description: string; count?: number }) {
  return (
    <Link
      href={href}
      className="bg-white border rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
            {count}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
    </Link>
  );
}
