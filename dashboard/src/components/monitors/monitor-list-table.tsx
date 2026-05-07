"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MonitorListRow } from "@/lib/monitors";
import {
  formatCondition,
  formatMetricValue,
  formatRelativeTime,
  formatScope,
  resolveMonitorStatus,
  type MonitorRenderStatus,
} from "./monitor-format";
import { MonitorStatusPill } from "./monitor-status-pill";

/**
 * Keyboard-navigable monitor list. Tab focuses each row; Enter / Space
 * navigates to its detail page; ↑ / ↓ move between rows; Home / End jump
 * to the first / last. The whole row is the click target — the inner
 * `<Link>` from V1.0 was removed because it duplicated the affordance and
 * confused tab order.
 *
 * Why a client component: every row needs `router.push` for the click
 * + Enter handler. Splitting "header server, rows client" multiplied
 * islands without simplifying anything; the data fetch is on the page
 * (which stays server) and `monitors` is the only prop.
 *
 * Accessibility:
 *  - Each `<tr>` gets `role="link"` + `aria-label` so screen readers
 *    announce the row as a single navigable thing rather than narrating
 *    every cell.
 *  - `tabIndex={0}` makes it part of the natural tab order.
 *  - `focus-visible:` ring lights up the active row instead of an inner
 *    element.
 *  - Arrow-key nav uses `previousElementSibling` / `firstElementChild` on
 *    the parent `<tbody>`, which works because every row is a direct
 *    sibling — the table never inserts non-row children.
 */

const STATUS_LABEL: Record<MonitorRenderStatus, string> = {
  firing: "Firing",
  ok: "Ok",
  disabled: "Disabled",
};

export function MonitorListTable({ monitors }: { monitors: MonitorListRow[] }) {
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Condition</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead className="text-right">Last value</TableHead>
          <TableHead className="text-right">Last evaluated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {monitors.map((m) => {
          const status = resolveMonitorStatus({
            enabled: m.enabled,
            state: m.state,
          });
          const condition = formatCondition({
            metric: m.metric,
            comparator: m.comparator,
            threshold: m.threshold,
            windowMinutes: m.windowMinutes,
          });
          const href = `/monitors/${m.id}`;
          const ariaLabel = `${m.name}, ${STATUS_LABEL[status]}, ${condition}`;

          const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
            switch (event.key) {
              case "Enter":
              case " ":
                event.preventDefault();
                router.push(href);
                return;
              case "ArrowDown": {
                event.preventDefault();
                const next = event.currentTarget.nextElementSibling;
                if (next instanceof HTMLElement) next.focus();
                return;
              }
              case "ArrowUp": {
                event.preventDefault();
                const prev = event.currentTarget.previousElementSibling;
                if (prev instanceof HTMLElement) prev.focus();
                return;
              }
              case "Home": {
                event.preventDefault();
                const first = event.currentTarget.parentElement?.firstElementChild;
                if (first instanceof HTMLElement) first.focus();
                return;
              }
              case "End": {
                event.preventDefault();
                const last = event.currentTarget.parentElement?.lastElementChild;
                if (last instanceof HTMLElement) last.focus();
                return;
              }
            }
          };

          return (
            <TableRow
              key={m.id}
              tabIndex={0}
              role="link"
              aria-label={ariaLabel}
              onClick={() => router.push(href)}
              onKeyDown={handleKeyDown}
              className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <TableCell>
                <MonitorStatusPill status={status} />
              </TableCell>
              <TableCell>
                <span className="font-medium text-foreground">{m.name}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{condition}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatScope({ environment: m.environment, model: m.model })}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {m.lastValue !== null
                  ? formatMetricValue(m.metric, m.lastValue)
                  : "—"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatRelativeTime(m.lastEvaluatedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
