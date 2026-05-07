"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Toast primitive — context-driven notifier. shadcn-shape API:
 *
 *   // app/(dashboard)/layout.tsx
 *   <ToastProvider>{children}<Toaster /></ToastProvider>
 *
 *   // any client component
 *   const { toast } = useToast();
 *   toast({ title: "Monitor created", variant: "success" });
 *
 * No external dep (sonner / react-hot-toast). Each toast is rendered in a
 * portal-mounted viewport in the bottom-right with a default 5s auto-dismiss.
 *
 * Server-action ergonomics: server actions can't call the hook directly.
 * Standard pattern: have the action return `{ message, variant }`, and the
 * client component that invoked it surfaces the toast.
 */

type ToastVariant = "default" | "success" | "destructive" | "info";

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. 0 disables the timer. Default 5000. */
  duration?: number;
}

interface ToastRecord extends ToastInput {
  id: string;
}

interface ToastContextValue {
  toasts: ToastRecord[];
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  // Track per-toast timers so explicit dismiss clears the timeout.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      // crypto.randomUUID is available in modern browsers + Node 19+; the
      // dashboard targets evergreen browsers via Next 16, so this is safe.
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((prev) => [...prev, { ...input, id }]);
      const duration = input.duration ?? 5000;
      if (duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, handle);
      }
      return id;
    },
    [dismiss]
  );

  // Cleanup on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((handle) => clearTimeout(handle));
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be called inside <ToastProvider>");
  }
  return ctx;
}

const toastVariants = cva(
  "pointer-events-auto flex w-80 items-start gap-3 rounded-2xl border tech-border bg-panel p-4 shadow-lg shadow-black/20",
  {
    variants: {
      variant: {
        default: "",
        success:
          "border-[color:color-mix(in_oklab,var(--color-foreground),transparent_70%)]",
        destructive: "border-destructive/40 bg-destructive/5",
        info: "",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  default: Info,
  success: CheckCircle2,
  destructive: AlertCircle,
  info: Info,
};

const ICON_TONE: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-foreground",
  destructive: "text-destructive",
  info: "text-muted-foreground",
};

interface ToastItemProps extends VariantProps<typeof toastVariants> {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const variant = toast.variant ?? "default";
  const Icon = ICONS[variant];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(toastVariants({ variant }))}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_TONE[variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-panel-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Renders the active toasts. Place once near the dashboard layout root,
 * after `<ToastProvider>`.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>,
    document.body
  );
}
