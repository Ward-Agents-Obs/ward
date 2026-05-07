"use client";

import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { useTheme } from "next-themes";

/**
 * Toast primitive — backed by `sonner` as of #38 (V1.1). The V1
 * implementation was a hand-rolled context + portal viewport that
 * deliberately omitted swipe-to-dismiss, animation, and dedupe; sonner
 * gives us all three plus action buttons, promises, and a tested
 * accessibility surface.
 *
 * Public API preserved exactly so consumer call sites (3 today:
 * `<CreateMonitorButton>`, `<EditMonitorButton>`, `<KeysClient>`) don't
 * change:
 *
 *   <ToastProvider>{children}<Toaster /></ToastProvider>   // in layout
 *
 *   const { toast } = useToast();                           // in client
 *   toast({ title, description?, variant?, duration? });
 *
 * `ToastProvider` becomes a no-op pass-through — sonner manages its own
 * state internally so the provider isn't structurally needed, but keeping
 * the export means `app/(dashboard)/layout.tsx` doesn't need to change.
 */

type ToastVariant = "default" | "success" | "destructive" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. Default 5000 (sonner default). */
  duration?: number;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  // Sonner doesn't need a provider — kept as a pass-through so the layout's
  // import + wrapping stays exactly as it was. Removing the wrapper would
  // be a separate cleanup.
  return <>{children}</>;
}

export function Toaster() {
  // `useTheme()` from next-themes resolves to "light" | "dark" | "system".
  // Sonner accepts the same set; "system" makes the toast theme follow
  // the user's OS preference, matching the rest of the dashboard.
  const { theme } = useTheme();
  return (
    <SonnerToaster
      position="bottom-right"
      theme={(theme === "dark" || theme === "light" ? theme : "system") as "light" | "dark" | "system"}
      // `richColors` adds variant-specific tinting (success green,
      // destructive red) on top of our base styles. Combined with the
      // explicit `classNames` below it gives us tone + tokens together.
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "rounded-2xl border tech-border bg-panel text-foreground shadow-lg shadow-black/20",
          title: "text-sm font-medium text-foreground",
          description: "text-xs leading-5 text-muted-foreground",
          closeButton:
            "text-muted-foreground hover:bg-panel-hover hover:text-foreground",
        },
      }}
    />
  );
}

/**
 * Hook returning the imperative toast API. Stateless — sonner owns the
 * queue. Kept as a hook (not a plain function) so the export shape matches
 * the V1 contract and consumers don't need to update import statements.
 */
export function useToast() {
  return {
    toast,
    dismiss,
  };
}

/**
 * Imperative toast call. Available outside hooks (e.g. server-action
 * follow-ups in async-action handlers) by importing directly:
 *
 *     import { toast } from "@/components/ui/toast";
 *     toast({ title: "Saved", variant: "success" });
 */
export function toast(input: ToastInput): string | number {
  const opts = {
    description: input.description,
    duration: input.duration,
  };
  switch (input.variant) {
    case "success":
      return sonnerToast.success(input.title, opts);
    case "destructive":
      return sonnerToast.error(input.title, opts);
    case "info":
      return sonnerToast.info(input.title, opts);
    case "default":
    case undefined:
      return sonnerToast(input.title, opts);
  }
}

/** Dismiss a specific toast by id, or omit to dismiss all. */
export function dismiss(id?: string | number): void {
  sonnerToast.dismiss(id);
}
