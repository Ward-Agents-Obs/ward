import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea primitive. Same shape language as `<Input>`, just a multi-line
 * variant for description-style fields. No autoresize in V1 — matches the
 * deliberate-omissions list in `components/ui/README.md`. Pair with `<Label>`
 * via `htmlFor` for accessibility.
 */
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "flex w-full rounded-lg border tech-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
