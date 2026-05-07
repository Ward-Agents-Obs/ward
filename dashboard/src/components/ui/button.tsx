"use client";

import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button primitive. Variant + size system via class-variance-authority.
 *
 * Variants chosen to match how buttons are currently used in the codebase:
 * - `default` — solid foreground/background (the existing "Create" / "Save" CTAs)
 * - `secondary` — bordered panel button (existing "Load more" / "Manage" links)
 * - `ghost` — transparent, hover only (existing icon buttons in the sidebar)
 * - `destructive` — danger actions (revoke key, delete monitor)
 * - `link` — text-only with underline-on-hover (existing inline links)
 *
 * Sizes: `sm` (compact, used in tables), `default`, `lg` (hero CTAs), `icon`
 * (square button containing only a lucide icon).
 *
 * `asChild` lets the button styles project onto a single child element
 * instead of rendering a `<button>`. The standard use is wrapping a
 * `<Link>` so a navigation looks like a CTA but stays an `<a>`:
 *
 *   <Button asChild>
 *     <Link href="/foo">Open</Link>
 *   </Button>
 *
 * Implemented with `@radix-ui/react-slot`, which forwards the variant
 * classes onto the child while preserving its semantics.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-accent-hover",
        secondary:
          "border tech-border bg-panel text-foreground hover:bg-panel-hover",
        ghost: "text-muted-foreground hover:bg-panel hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-10 px-4 py-2",
        lg: "h-11 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * When true, render the child element with the button styles applied
   * (via `@radix-ui/react-slot`) instead of a `<button>`. Use to project
   * Button styling onto a `<Link>`, anchor, or other interactive element
   * without nested-interactive-elements HTML.
   */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    if (asChild) {
      // When projecting onto a child element we must NOT inject `type` —
      // the child controls its own semantics (`<a>`, `<Link>`, etc.).
      return (
        <Slot
          ref={ref}
          className={cn(buttonVariants({ variant, size, className }))}
          {...props}
        />
      );
    }
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
