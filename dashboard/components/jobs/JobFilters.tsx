"use client";

import { Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";

export interface JobFiltersState {
  search?: string;
  minScore?: number;
  remoteOnly?: boolean;
  sortBy?: "relevance_score" | "created_at" | "posted_date";
  sortDir?: "asc" | "desc";
}

interface JobFiltersProps {
  filters: JobFiltersState;
  onFiltersChange: (filters: JobFiltersState) => void;
}

export default function JobFilters({ filters, onFiltersChange }: JobFiltersProps) {
  const update = (partial: Partial<JobFiltersState>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        {/* Text search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search jobs by title, company, keywords..."
            value={filters.search ?? ""}
            onChange={(e) => update({ search: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
          />
        </div>

        {/* Minimum score slider */}
        <div className="flex items-center gap-2 min-w-[200px]">
          <SlidersHorizontal className="w-4 h-4 text-gray-500 shrink-0" />
          <label className="text-sm text-gray-600 whitespace-nowrap">
            Min Score: <span className="font-semibold text-gray-900">{filters.minScore ?? 0}</span>
          </label>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={filters.minScore ?? 0}
            onChange={(e) => update({ minScore: Number(e.target.value) })}
            className="w-24 accent-blue-600"
          />
        </div>

        {/* Remote only toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div className="relative">
            <input
              type="checkbox"
              checked={filters.remoteOnly ?? false}
              onChange={(e) => update({ remoteOnly: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 rounded-full bg-gray-200 peer-checked:bg-blue-600 transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <span className="text-sm text-gray-600">Remote Only</span>
        </label>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-gray-500 shrink-0" />
          <select
            value={filters.sortBy ?? "relevance_score"}
            onChange={(e) => update({ sortBy: e.target.value as JobFiltersState["sortBy"] })}
            className="rounded-lg border border-gray-200 bg-gray-50 py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
          >
            <option value="relevance_score">Sort by Relevance</option>
            <option value="created_at">Sort by Date Added</option>
            <option value="posted_date">Sort by Posted Date</option>
          </select>
          <button
            onClick={() =>
              update({ sortDir: filters.sortDir === "asc" ? "desc" : "asc" })
            }
            className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            title={filters.sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {filters.sortDir === "asc" ? "ASC" : "DESC"}
          </button>
        </div>
      </div>
    </div>
  );
}
