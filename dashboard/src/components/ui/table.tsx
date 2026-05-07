import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitive set. Replaces the ad-hoc table styling currently
 * duplicated across `trace-table.tsx`, `session-table.tsx`,
 * `api-key-table.tsx`, and `costs/client.tsx`. Migration of those
 * call sites lands in a follow-up styling sweep — this file just makes
 * the primitives importable.
 *
 * Components mirror shadcn/ui's exact API for forward compatibility:
 *   <Table>
 *     <TableHeader>
 *       <TableRow><TableHead>Name</TableHead></TableRow>
 *     </TableHeader>
 *     <TableBody>
 *       <TableRow><TableCell>Foo</TableCell></TableRow>
 *     </TableBody>
 *   </Table>
 */

export const Table = forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="overflow-x-auto rounded-xl border tech-border bg-panel">
    <table
      ref={ref}
      className={cn("w-full text-sm", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("border-b tech-border bg-panel-hover/50", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("divide-y divide-[color:var(--border)]/60", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

export const TableRow = forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("transition-colors hover:bg-panel-hover", className)}
    {...props}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-4 py-3 align-middle text-foreground", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";
