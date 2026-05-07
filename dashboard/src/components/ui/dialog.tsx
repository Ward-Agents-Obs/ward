"use client";

import { forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog primitive — modal overlay backed by `@radix-ui/react-dialog`. The
 * V1 hand-rolled implementation handled focus trap, Escape, scroll lock,
 * and return-focus-on-close, but lacked:
 *  - `inert` background tree so AT users couldn't tab into hidden content
 *  - SR announcer that pairs `Dialog.Title` / `Dialog.Description` to the
 *    `aria-labelledby` / `aria-describedby` of the modal
 *  - portal container customisation
 *
 * V1.1 (#38) swaps the internals to Radix while preserving the exact
 * public API consumers were already using:
 *
 *   const [open, setOpen] = useState(false);
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>Create monitor</DialogTitle>
 *         <DialogDescription>...</DialogDescription>
 *       </DialogHeader>
 *       …form…
 *       <DialogFooter>
 *         <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
 *         <Button type="submit">Save</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * Consumers (`<MonitorFormDialog>`, `<CreateKeyDialog>`) and any future
 * users do not need code changes. Tokens are unchanged — only the
 * underlying state management + a11y plumbing is now Radix-driven.
 */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * When true, clicking the backdrop does NOT close the dialog. Esc and
   * the explicit close button still work — used by mid-form modals where
   * a stray click would lose unsaved input (see `<CreateKeyDialog>` /
   * `<MonitorFormDialog>`).
   */
  disableOverlayClose?: boolean;
}

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, disableOverlayClose = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
    <DialogPrimitive.Content
      ref={ref}
      // `onPointerDownOutside` covers the click-outside path; preventing
      // default keeps the dialog open. Esc has its own handler we don't
      // touch — Radix preserves that close path. `onInteractOutside` would
      // also block focus-shift events; leaving it default-on so SR users
      // who tab away still close cleanly.
      onPointerDownOutside={
        disableOverlayClose ? (event) => event.preventDefault() : undefined
      }
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border tech-border bg-panel p-6 shadow-2xl shadow-black/30 focus:outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Close"
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-panel-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />
  );
}

export const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  // Radix wires `aria-labelledby` from this Title's id onto the Content
  // element automatically — that's the SR announcer feature the V1 impl
  // had to fake with manual `id` plumbing.
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  // Same auto-pairing — `aria-describedby` flows to the Content from this
  // element. If a dialog ships without a Description, Radix logs a console
  // warning in dev (a11y heuristic). Add `<DialogDescription>` or annotate
  // with `aria-describedby={undefined}` on the Content if intentionally
  // omitted; we don't currently omit anywhere.
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-6 text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

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
