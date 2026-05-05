"use client";

import Link from "next/link";
import type { SessionRow } from "@/lib/queries/sessions";
import { formatCost, formatLatency } from "@/lib/utils";

interface SessionTableProps {
  sessions: SessionRow[];
  sessionHrefBase?: string;
}

export function SessionTable({ sessions, sessionHrefBase = "/traces" }: SessionTableProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center text-zinc-500">
        No sessions found. Start sending data through the SDK to see sessions here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-900/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Session ID</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">First Message</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Last Message</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Duration</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Start Time</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Traces</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Tokens</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sessions.map((session) => (
            <tr
              key={session.sessionId}
              className="transition-colors hover:bg-zinc-900/50"
            >
              <td className="px-4 py-3">
                <Link
                  href={`${sessionHrefBase}/${session.sessionId}`}
                  className="font-medium text-foreground hover:underline font-mono text-xs"
                >
                  {session.sessionId?.slice(0, 16) || "—"}...
                </Link>
              </td>
              <td className="px-4 py-3 max-w-xs">
                <div className="truncate text-zinc-300" title={session.firstMessage}>
                  {session.firstMessage || "—"}
                </div>
              </td>
              <td className="px-4 py-3 max-w-xs">
                <div className="truncate text-zinc-300" title={session.lastMessage}>
                  {session.lastMessage || "—"}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                {formatLatency(session.duration)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                {new Date(session.startTime).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                {session.traces}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                {session.totalTokens?.toLocaleString() || "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                {session.cost > 0 ? formatCost(session.cost) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}