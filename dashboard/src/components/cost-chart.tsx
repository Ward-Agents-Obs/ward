"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/**
 * Chart components consumed by `/costs/client.tsx`. Migrated to design tokens
 * as part of #43 (styling-drift sweep) — the V1.0 implementation hardcoded
 * `#18181b` / `#27272a` / `#a1a1aa` etc. which broke the charts in light mode.
 *
 * Recharts doesn't accept CSS variables for axis tick fills (those need a
 * literal colour), so AXIS_TICK uses `var(...)` wrapped in a CSSProperties
 * for the tooltip wrapper but a literal `currentColor` for ticks. The page
 * sets `text-muted-foreground` on the chart wrapper so `currentColor`
 * resolves to the muted token. The series colours stay literal because they
 * encode the chart's category palette (not the theme).
 */

// Categorical palette — used to colour series, not theme surfaces. Keep as
// literals; the design token system doesn't define data-vis colours.
const SERIES_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fb923c",
  "#facc15",
  "#818cf8",
];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
};
const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "var(--foreground)",
};

// Recharts ticks accept any string; passing a CSS variable works in modern
// browsers because Recharts forwards it as a `fill=` attribute on SVG text.
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

interface BarChartData {
  name: string;
  value: number;
}

export function CostBarChart({ data }: { data: BarChartData[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
          />
          <Bar dataKey="value" fill={SERIES_COLORS[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface AreaChartData {
  date: string;
  [model: string]: string | number;
}

export function CostAreaChart({ data, models }: { data: AreaChartData[]; models: string[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
          />
          {models.map((model, i) => (
            <Area
              key={model}
              type="monotone"
              dataKey={model}
              stackId="1"
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              fillOpacity={0.3}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostPieChart({ data }: { data: BarChartData[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }) =>
              `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
          >
            {data.map((_, i) => (
              <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
