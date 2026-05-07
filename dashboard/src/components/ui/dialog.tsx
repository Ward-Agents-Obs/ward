"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog primitive — modal overlay with portal mount, escape-to-close,
 * overlay-click-to-close, and a basic focus trap. Designed to match
 * shadcn/Radix's API surface so we can swap to `@radix-ui/react-dialog` once
 * architect signs off on the dep without rewriting call sites.
 *
 * Accessibility pieces present:
 *  - role="dialog" + aria-modal + aria-labelledby/aria-describedby
 *  - Escape closes
 *  - Returns focus to the trigger on close
 *  - Locks body scroll while open
 *  - Tab/Shift+Tab focus trap inside the panel
 *
 * Pieces NOT present (vs Radix):
 *  - inert background tree (we use pointer-events-none on a sibling overlay)
 *  - announcer for screen-reader open/close
 *  - portal container customisation
 *
 * Usage (controlled):
 *   const [open, setOpen] = useState(false);
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>Create monitor</DialogTitle>
 *         <DialogDescription>...</DialogDescription>
 *       </DialogHeader>
 *       ...form...
 *       <DialogFooter>
 *         <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
 *         <Button type="submit">Save</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialog(component: string) {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Dialog>`);
  }
  return ctx;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const id = useId();
  const ctx = useMemo<DialogContextValue>(
    () => ({
      open,
      setOpen: onOpenChange,
      titleId: `${id}-title`,
      descriptionId: `${id}-description`,
    }),
    [open, onOpenChange, id]
  );
  return <DialogContext.Provider value={ctx}>{children}</DialogContext.Provider>;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** When true, clicking the backdrop does NOT close the dialog. */
  disableOverlayClose?: boolean;
}

export function DialogContent({
  className,
  children,
  disableOverlayClose = false,
  ...props
}: DialogContentProps) {
  const { open, setOpen, titleId, descriptionId } = useDialog("DialogContent");
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the element that had focus when the dialog opened so we can
  // return focus there when it closes. This is the SR experience users
  // expect from any well-behaved modal.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [open]);

  // Focus the first focusable element inside the panel on open.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      FOCUSABLE_SELECTOR
    );
    (focusables[0] ?? panelRef.current).focus();
  }, [open]);

  // Escape closes; Tab cycles focus inside the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("data-focus-skip"));
      if (focusables.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onOverlayClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disableOverlayClose) return;
      if (event.target === event.currentTarget) setOpen(false);
    },
    [disableOverlayClose, setOpen]
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={onOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md rounded-2xl border tech-border bg-panel p-6 shadow-2xl shadow-black/30 focus:outline-none",
          className
        )}
        {...props}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-panel-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialog("DialogTitle");
  return (
    <h2
      id={titleId}
      className={cn(
        "text-lg font-semibold tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialog("DialogDescription");
  return (
    <p
      id={descriptionId}
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}
