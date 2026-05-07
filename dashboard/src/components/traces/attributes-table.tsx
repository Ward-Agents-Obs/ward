import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Render a span's attribute bag as a searchable-shaped key/value table.
 * Replaces the JSON-stringify dump that the V1.0 trace detail used.
 *
 * The component is intentionally structural rather than interactive: filter
 * UI on the attributes table is out of V1 scope. Keys are sorted so the
 * order is stable across span instances.
 */
export function AttributesTable({
  attributes,
}: {
  attributes: Record<string, unknown> | null | undefined;
}) {
  const entries = Object.entries(attributes ?? {})
    .filter(([, value]) => value !== "" && value != null)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No additional attributes on this span.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/3">Attribute</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(([key, value]) => (
          <TableRow key={key}>
            <TableCell className="align-top font-mono text-xs text-muted-foreground">
              {key}
            </TableCell>
            <TableCell className="align-top font-mono text-xs text-foreground">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                {formatValue(value)}
              </pre>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Coerce arbitrary attribute values to a printable string. Most OTel attrs
 * are scalars but tools occasionally pack JSON into a single attribute, so
 * objects/arrays are pretty-printed.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
