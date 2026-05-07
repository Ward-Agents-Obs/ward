"use client";

import { createContext, useContext, useId, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs primitive — controlled-only API matching shadcn/Radix shape so we can
 * swap to `@radix-ui/react-tabs` later without changing call sites.
 *
 * Usage:
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabsList>
 *       <TabsTrigger value="list">List</TabsTrigger>
 *       <TabsTrigger value="sessions">Sessions</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="list">…</TabsContent>
 *     <TabsContent value="sessions">…</TabsContent>
 *   </Tabs>
 *
 * No roving tabindex / arrow-key navigation in V1 (Radix's a11y win we don't
 * have yet). Each trigger is a real <button>, so Tab/Shift+Tab + Enter still
 * work; what's missing is Left/Right between siblings without leaving the
 * tablist.
 */

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  rootId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string) {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Tabs>`);
  }
  return ctx;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
}

export function Tabs({
  value,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const rootId = useId();
  const ctx = useMemo(
    () => ({ value, onValueChange, rootId }),
    [value, onValueChange, rootId]
  );
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border tech-border bg-panel p-1",
        className
      )}
      {...props}
    />
  );
}

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  className,
  type = "button",
  ...props
}: TabsTriggerProps) {
  const { value: active, onValueChange, rootId } = useTabs("TabsTrigger");
  const isActive = active === value;
  return (
    <button
      role="tab"
      type={type}
      id={`${rootId}-trigger-${value}`}
      aria-selected={isActive}
      aria-controls={`${rootId}-content-${value}`}
      tabIndex={isActive ? 0 : -1}
      onClick={() => onValueChange(value)}
      className={cn(
        "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:bg-panel-hover hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({
  value,
  className,
  ...props
}: TabsContentProps) {
  const { value: active, rootId } = useTabs("TabsContent");
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${rootId}-content-${value}`}
      aria-labelledby={`${rootId}-trigger-${value}`}
      className={cn("mt-4 focus-visible:outline-none", className)}
      tabIndex={0}
      {...props}
    />
  );
}
