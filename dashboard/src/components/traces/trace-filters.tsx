"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Filter, Download, Zap, ZapOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface TraceFiltersProps {
  availableEnvironments?: string[];
  availableModels?: string[];
  className?: string;
}

const TIME_RANGES = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "custom", label: "Custom" },
];

export function TraceFilters({
  availableEnvironments = [],
  availableModels = [],
  className
}: TraceFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [isLive, setIsLive] = useState(false);

  const currentFilters = useMemo(() => ({
    timeRange: searchParams.get("timeRange") || "24h",
    environment: searchParams.get("environment") || "",
    model: searchParams.get("model") || "",
    search: searchParams.get("search") || "",
  }), [searchParams]);

  const updateFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    router.replace(`?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ search });
  };

  const clearFilters = () => {
    setSearch("");
    router.replace("?");
  };

  const hasActiveFilters = currentFilters.environment || currentFilters.model || currentFilters.search;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Time Range and Live Toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {TIME_RANGES.map((range) => (
            <button
              key={range.value}
              onClick={() => updateFilters({ timeRange: range.value })}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                currentFilters.timeRange === range.value
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-panel-hover border tech-border"
              )}
            >
              {range.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsLive(!isLive)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
              isLive
                ? "bg-green-600 text-white"
                : "bg-background text-foreground hover:bg-panel-hover border tech-border"
            )}
          >
            {isLive ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
            Live
          </button>

          <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-background text-foreground hover:bg-panel-hover border tech-border transition-colors">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <form onSubmit={handleSearchSubmit} className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Search messages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-background border tech-border rounded-lg text-sm text-foreground placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>
        </form>

        {availableEnvironments.length > 0 && (
          <select
            value={currentFilters.environment}
            onChange={(e) => updateFilters({ environment: e.target.value })}
            className="px-3 py-2 bg-background border tech-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            <option value="">All Environments</option>
            {availableEnvironments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        )}

        {availableModels.length > 0 && (
          <select
            value={currentFilters.model}
            onChange={(e) => updateFilters({ model: e.target.value })}
            className="px-3 py-2 bg-background border tech-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            <option value="">All Models</option>
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        )}

        <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-background text-foreground hover:bg-panel-hover border tech-border transition-colors">
          <Filter className="h-4 w-4" />
          Filters
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}