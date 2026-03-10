"use client";

import { useApplications } from "@/lib/hooks/useApplications";
import KanbanBoard from "@/components/pipeline/KanbanBoard";
import { Loader2, Kanban } from "lucide-react";

export default function PipelinePage() {
  const { grouped, loading, updateStatus, toggleFavorite } =
    useApplications();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Kanban className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
            <p className="text-sm text-gray-500">
              Track your job applications across stages
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            <span className="ml-2 text-sm text-gray-500">
              Loading pipeline...
            </span>
          </div>
        )}

        {!loading && (
          <KanbanBoard
            grouped={grouped}
            updateStatus={updateStatus}
            toggleFavorite={toggleFavorite}
          />
        )}
      </div>
    </div>
  );
}
