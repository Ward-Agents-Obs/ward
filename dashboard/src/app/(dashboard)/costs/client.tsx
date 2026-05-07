"use client";

import { CostAreaChart, CostPieChart } from "@/components/cost-chart";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCost, formatNumber } from "@/lib/utils";

/**
 * Client-side renderer for the /costs page. Migrated to V1 ui primitives as
 * part of #43 — Card for the chart panels, Table primitive set for the
 * model breakdown. Behaviour is unchanged from V1.0.
 */
interface CostsClientProps {
  areaData: Record<string, unknown>[];
  models: string[];
  pieData: { name: string; value: number }[];
  tableData: {
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  }[];
}

export function CostsClient({ areaData, models, pieData, tableData }: CostsClientProps) {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost over time</CardTitle>
            <CardDescription>
              Stacked spend per model across the window.
            </CardDescription>
          </CardHeader>
          <div className="mt-4">
            <CostAreaChart
              data={areaData as { date: string; [k: string]: string | number }[]}
              models={models}
            />
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost by model</CardTitle>
            <CardDescription>Total spend share over the window.</CardDescription>
          </CardHeader>
          <div className="mt-4">
            <CostPieChart data={pieData} />
          </div>
        </Card>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Input tokens</TableHead>
            <TableHead className="text-right">Output tokens</TableHead>
            <TableHead className="text-right">Total cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableData.map((row) => (
            <TableRow key={row.model}>
              <TableCell>
                <span className="rounded bg-background px-2 py-0.5 font-mono text-xs">
                  {row.model}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.requests)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.inputTokens)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.outputTokens)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCost(row.totalCost)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
