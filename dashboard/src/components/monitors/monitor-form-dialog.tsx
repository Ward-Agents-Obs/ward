"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCost, formatLatency } from "@/lib/utils";
import {
  MONITOR_COMPARATORS,
  MONITOR_METRICS,
  MONITOR_WINDOWS,
  type Monitor,
  type MonitorComparator,
  type MonitorInput,
  type MonitorMetric,
  type MonitorWindow,
} from "@/lib/monitors";
import {
  createMonitor,
  previewMonitorMetricAction,
  updateMonitor,
  type MonitorActionResult,
} from "@/app/(dashboard)/monitors/actions";

/**
 * Create/Edit Monitor modal (F8 / task #19).
 *
 * Form fields per `.agents/monitors-design.md` §6:
 *   1. Name (required, ≤80)
 *   2. Description (optional, ≤280)
 *   3. Metric — segmented (Cost / p95 latency / Error rate)
 *   4. Comparator + Threshold — `<Select>` + numeric `<Input>` with unit hint
 *   5. Window — segmented (5m / 15m / 1h / 6h / 24h)
 *   6. Scope — collapsible Filters; environment + model `<Select>`
 *   7. Preview — debounced 500ms, calls `previewMonitorMetricAction`
 *
 * Validation is hand-rolled in `lib/monitors.ts::validateMonitorInput`
 * until backend's #15 introduces the canonical zod schema. Field-level
 * errors light up next to the right input, modal-level errors render
 * above the footer.
 *
 * The modal API matches our Dialog primitive — controlled `open` /
 * `onOpenChange` — and accepts an optional `initial` Monitor for edit
 * mode. `onSaved` fires with the updated monitor so the caller (F7 list
 * page) can close the modal and refresh the table.
 */

const METRIC_LABELS: Record<MonitorMetric, string> = {
  cost: "Cost",
  latency_p95: "p95 latency",
  error_rate: "Error rate",
};

const METRIC_DESCRIPTIONS: Record<MonitorMetric, string> = {
  cost: "Total spend across the window",
  latency_p95: "95th-percentile span duration",
  error_rate: "Failed spans as a fraction of total",
};

const COMPARATOR_LABELS: Record<MonitorComparator, string> = {
  gt: "greater than",
  gte: "greater than or equal to",
  lt: "less than",
  lte: "less than or equal to",
};

const WINDOW_LABELS: Record<MonitorWindow, string> = {
  5: "5m",
  15: "15m",
  60: "1h",
  360: "6h",
  1440: "24h",
};

const METRIC_UNIT_HINT: Record<MonitorMetric, string> = {
  cost: "USD",
  latency_p95: "ms",
  error_rate: "% (e.g. 5 = 5%)",
};

interface MonitorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, modal opens in edit mode and pre-fills the form. */
  initial?: Monitor | null;
  /**
   * Distinct envs/models from the tenant's existing spans — populates the
   * Filters dropdowns. Caller (server component) fetches via the existing
   * `getDistinctEnvironments` / `getDistinctModels` queries.
   */
  availableEnvironments?: string[];
  availableModels?: string[];
  /** Fired with the saved monitor on success. Caller closes the modal. */
  onSaved?: (monitor: Monitor) => void;
}

interface FormState {
  name: string;
  description: string;
  metric: MonitorMetric;
  comparator: MonitorComparator;
  threshold: string; // string until parse-on-submit
  windowMinutes: MonitorWindow;
  environment: string;
  model: string;
}

const DEFAULT_STATE: FormState = {
  name: "",
  description: "",
  metric: "cost",
  comparator: "gt",
  threshold: "",
  windowMinutes: 60,
  environment: "",
  model: "",
};

function stateFromInitial(initial: Monitor | null | undefined): FormState {
  if (!initial) return DEFAULT_STATE;
  return {
    name: initial.name,
    description: initial.description ?? "",
    metric: initial.metric,
    comparator: initial.comparator,
    threshold: String(initial.threshold),
    windowMinutes: initial.windowMinutes,
    environment: initial.environment ?? "",
    model: initial.model ?? "",
  };
}

function buildInput(form: FormState): MonitorInput {
  return {
    name: form.name,
    description: form.description.trim() || null,
    metric: form.metric,
    comparator: form.comparator,
    threshold: Number(form.threshold),
    windowMinutes: form.windowMinutes,
    environment: form.environment || null,
    model: form.model || null,
  };
}

export function MonitorFormDialog({
  open,
  onOpenChange,
  initial,
  availableEnvironments = [],
  availableModels = [],
  onSaved,
}: MonitorFormDialogProps) {
  const isEdit = Boolean(initial);
  // Re-key the form when initial changes so editing one row, closing, and
  // editing another row resets state cleanly without a manual reset.
  const formKey = useMemo(() => initial?.id ?? "create", [initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        // Prevent stray overlay clicks from closing while the user is
        // mid-form. Esc + the explicit close button stay enabled.
        disableOverlayClose
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit monitor" : "Create monitor"}</DialogTitle>
          <DialogDescription>
            Alert when a tenant-wide metric crosses a threshold over a fixed
            window. Scope to a single environment or model, or leave blank to
            cover everything.
          </DialogDescription>
        </DialogHeader>

        <FormBody
          key={formKey}
          initial={initial ?? null}
          availableEnvironments={availableEnvironments}
          availableModels={availableModels}
          isEdit={isEdit}
          onCancel={() => onOpenChange(false)}
          onSaved={(monitor) => {
            onSaved?.(monitor);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Form body — hosts state and validation. Lives below the Dialog primitive
// so a mode change (create ↔ edit a different monitor) can re-mount the
// whole form via `key`, dropping any in-flight preview / errors cleanly.
// ---------------------------------------------------------------------------

interface FormBodyProps {
  initial: Monitor | null;
  availableEnvironments: string[];
  availableModels: string[];
  isEdit: boolean;
  onCancel: () => void;
  onSaved: (monitor: Monitor) => void;
}

function FormBody({
  initial,
  availableEnvironments,
  availableModels,
  isEdit,
  onCancel,
  onSaved,
}: FormBodyProps) {
  const [form, setForm] = useState<FormState>(() => stateFromInitial(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const [scopeOpen, setScopeOpen] = useState(
    Boolean(initial?.environment) || Boolean(initial?.model),
  );

  // Stable ids for label/control association. Each input wires `htmlFor`
  // to one of these so screen readers announce the right label.
  const ids = useFieldIds();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    setTopLevelError(null);

    startSubmit(async () => {
      const input = buildInput(form);
      const result: MonitorActionResult =
        isEdit && initial
          ? await updateMonitor(initial.id, input)
          : await createMonitor(input);
      if (result.ok && result.monitor) {
        onSaved(result.monitor);
        return;
      }
      if (result.errors) setErrors(result.errors);
      if (result.message) setTopLevelError(result.message);
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-5">
      {/* Name */}
      <FieldRow
        id={ids.name}
        label="Name"
        required
        error={errors.name}
        hint="Shown in the list and the firing banner."
      >
        <Input
          id={ids.name}
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
          maxLength={80}
          required
          aria-invalid={Boolean(errors.name)}
          autoComplete="off"
        />
      </FieldRow>

      {/* Description */}
      <FieldRow
        id={ids.description}
        label="Description"
        error={errors.description}
        hint="Notes for your team. Optional."
      >
        <Textarea
          id={ids.description}
          value={form.description}
          onChange={(event) => set("description", event.target.value)}
          maxLength={280}
          rows={2}
          aria-invalid={Boolean(errors.description)}
        />
      </FieldRow>

      {/* Metric segmented */}
      <FieldRow id={ids.metric} label="Metric" required error={errors.metric}>
        <SegmentedRadio
          name="metric"
          value={form.metric}
          onChange={(value) => set("metric", value as MonitorMetric)}
          options={MONITOR_METRICS.map((value) => ({
            value,
            label: METRIC_LABELS[value],
            sub: METRIC_DESCRIPTIONS[value],
          }))}
        />
      </FieldRow>

      {/* Comparator + Threshold */}
      <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
        <FieldRow
          id={ids.comparator}
          label="Comparator"
          required
          error={errors.comparator}
        >
          <Select
            id={ids.comparator}
            value={form.comparator}
            onChange={(event) => set("comparator", event.target.value as MonitorComparator)}
            aria-invalid={Boolean(errors.comparator)}
          >
            {MONITOR_COMPARATORS.map((value) => (
              <option key={value} value={value}>
                {COMPARATOR_LABELS[value]}
              </option>
            ))}
          </Select>
        </FieldRow>
        <FieldRow
          id={ids.threshold}
          label="Threshold"
          required
          error={errors.threshold}
          hint={`Unit: ${METRIC_UNIT_HINT[form.metric]}`}
        >
          <Input
            id={ids.threshold}
            type="number"
            inputMode="decimal"
            step="any"
            value={form.threshold}
            onChange={(event) => set("threshold", event.target.value)}
            aria-invalid={Boolean(errors.threshold)}
            required
          />
        </FieldRow>
      </div>

      {/* Window segmented */}
      <FieldRow id={ids.window} label="Window" required error={errors.windowMinutes}>
        <SegmentedRadio
          name="window"
          value={String(form.windowMinutes)}
          onChange={(value) => set("windowMinutes", Number(value) as MonitorWindow)}
          options={MONITOR_WINDOWS.map((value) => ({
            value: String(value),
            label: WINDOW_LABELS[value],
          }))}
        />
      </FieldRow>

      {/* Scope (collapsible) */}
      <div className="rounded-2xl border tech-border bg-background">
        <button
          type="button"
          onClick={() => setScopeOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={scopeOpen}
        >
          <span>Filters (optional)</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              scopeOpen && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
        {scopeOpen ? (
          <div className="grid gap-4 border-t tech-border p-4 sm:grid-cols-2">
            <FieldRow
              id={ids.environment}
              label="Environment"
              error={errors.environment}
              hint="Single env, or leave as 'All'."
            >
              <Select
                id={ids.environment}
                value={form.environment}
                onChange={(event) => set("environment", event.target.value)}
              >
                <option value="">All environments</option>
                {availableEnvironments.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </Select>
            </FieldRow>
            <FieldRow
              id={ids.model}
              label="Model"
              error={errors.model}
              hint="Single model, or leave as 'All'."
            >
              <Select
                id={ids.model}
                value={form.model}
                onChange={(event) => set("model", event.target.value)}
              >
                <option value="">All models</option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            </FieldRow>
          </div>
        ) : null}
      </div>

      {/* Live preview */}
      <PreviewPane form={form} />

      {topLevelError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {topLevelError}
        </p>
      ) : null}

      <DialogFooter>
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {isEdit ? "Saving…" : "Creating…"}
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create monitor"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Preview pane — debounced live fetch of the metric's current value.
// ---------------------------------------------------------------------------

interface PreviewPaneProps {
  form: FormState;
}

function PreviewPane({ form }: PreviewPaneProps) {
  // The preview only depends on the four fields the backend query takes,
  // so debounce on those — no need to re-fetch when the user types in Name.
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        metric: form.metric,
        windowMinutes: form.windowMinutes,
        environment: form.environment || null,
        model: form.model || null,
      }),
    [form.metric, form.windowMinutes, form.environment, form.model]
  );

  type PreviewState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; value: number; asOf: string | null }
    | { status: "unavailable" }
    | { status: "error"; message: string };

  const [state, setState] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const handle = setTimeout(async () => {
      try {
        const result = await previewMonitorMetricAction({
          metric: form.metric,
          windowMinutes: form.windowMinutes,
          environment: form.environment || null,
          model: form.model || null,
        });
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error", message: result.message });
          return;
        }
        if (!result.result.ready) {
          setState({ status: "unavailable" });
          return;
        }
        setState({
          status: "ready",
          value: result.result.value,
          asOf: result.result.asOf,
        });
      } catch (cause) {
        if (cancelled) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : "Preview failed.",
        });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // previewKey captures all the fields we actually depend on; ESLint's
    // exhaustive-deps wants the raw fields too but they're stable as long
    // as previewKey is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  return (
    <div className="rounded-2xl border tech-border bg-background p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Live preview
        </h4>
        <span className="text-xs text-muted-foreground">
          {METRIC_LABELS[form.metric]} over {WINDOW_LABELS[form.windowMinutes]}
        </span>
      </div>
      <div className="mt-3 min-h-[2rem]">
        {state.status === "loading" ? (
          <p className="text-sm text-muted-foreground">Fetching current value…</p>
        ) : state.status === "ready" ? (
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {formatPreviewValue(form.metric, state.value)}
          </p>
        ) : state.status === "unavailable" ? (
          <p className="text-sm text-muted-foreground">
            Preview unavailable — backend task #17 (B10) wires the live
            ClickHouse query. Until then the form ships without a real preview
            value.
          </p>
        ) : state.status === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function formatPreviewValue(metric: MonitorMetric, value: number): string {
  switch (metric) {
    case "cost":
      return formatCost(value);
    case "latency_p95":
      return formatLatency(value);
    case "error_rate":
      return `${(value * 100).toFixed(2)}%`;
  }
}

// ---------------------------------------------------------------------------
// Small primitives kept inside this file — `<FieldRow>` and
// `<SegmentedRadio>`. They're tightly bound to the monitor form's layout and
// don't pull their weight as exported primitives yet.
// ---------------------------------------------------------------------------

interface FieldRowProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function FieldRow({ id, label, required, hint, error, children }: FieldRowProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">*</span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-xs font-medium text-destructive"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

interface SegmentedRadioOption {
  value: string;
  label: string;
  sub?: string;
}

interface SegmentedRadioProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: SegmentedRadioOption[];
}

function SegmentedRadio({ name, value, onChange, options }: SegmentedRadioProps) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="flex flex-wrap gap-2"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col items-start rounded-xl border tech-border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-foreground text-background"
                : "bg-panel text-foreground hover:bg-panel-hover"
            )}
          >
            <span className="font-medium">{opt.label}</span>
            {opt.sub ? (
              <span
                className={cn(
                  "text-[11px]",
                  isActive ? "text-background/70" : "text-muted-foreground"
                )}
              >
                {opt.sub}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// Generate stable, unique ids for every field so labels/inputs/error
// announcers wire up correctly per A11y. `useId()` is per-mount; combined
// with the `key={formKey}` on `<FormBody>` this means each form instance
// has its own id namespace.
function useFieldIds() {
  const root = useId();
  return useMemo(
    () => ({
      name: `${root}-name`,
      description: `${root}-description`,
      metric: `${root}-metric`,
      comparator: `${root}-comparator`,
      threshold: `${root}-threshold`,
      window: `${root}-window`,
      environment: `${root}-environment`,
      model: `${root}-model`,
    }),
    [root]
  );
}
