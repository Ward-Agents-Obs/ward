import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Label primitive. Plain semantic <label> with consistent typography.
 * Pair with Input via `htmlFor`; we don't add Radix Label's automatic id
 * association because we don't have the radix dep budget yet.
 */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";
