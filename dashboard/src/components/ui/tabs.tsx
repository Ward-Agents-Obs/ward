"use client";

import { forwardRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Tabs primitive — backed by `@radix-ui/react-tabs` as of #38 (V1.1). The
 * V1 hand-rolled implementation handled basic role / aria-selected /
 * tabindex wiring, but lacked:
 *  - arrow-key roving tabindex (Left/Right between siblings, Home/End to
 *    jump to first/last)
 *  - automatic activation mode (default `automatic` — focus a tab and the
 *    panel updates without an explicit click)
 *  - orientation handling (`horizontal` default, `vertical` if needed)
 *
 * V1.1 swaps the internals to Radix while preserving the exact public API:
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabsList>
 *       <TabsTrigger value="list">List</TabsTrigger>
 *       <TabsTrigger value="sessions">Sessions</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="list">…</TabsContent>
 *     <TabsContent value="sessions">…</TabsContent>
 *   </Tabs>
 *
 * Controlled-only — no consumers use uncontrolled today; if a future
 * consumer needs `defaultValue` they can pass it through directly.
 */

export interface TabsProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  value: string;
  onValueChange: (value: string) => void;
}

export const Tabs = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  TabsProps
>(({ value, onValueChange, ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    value={value}
    onValueChange={onValueChange}
    {...props}
  />
));
Tabs.displayName = "Tabs";

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-xl border tech-border bg-panel p-1",
      className
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  // Radix renders the right ARIA wiring (`role="tab"`, `aria-selected`,
  // `aria-controls`) and the roving tabindex; we only style. The
  // `data-[state=active]` attribute is the Radix idiom for "this tab is
  // currently selected" — replaces the V1 `isActive` ternary.
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "text-muted-foreground hover:bg-panel-hover hover:text-foreground",
      "data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
