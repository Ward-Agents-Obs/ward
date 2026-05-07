"use client";

import { forwardRef } from "react";
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
 * The `asChild` pattern is intentionally NOT exposed yet — adopting it
 * cleanly requires `@radix-ui/react-slot`, and architect's V1 scope rule
 * says no new top-level dependencies without sign-off. To wrap a Link, use
 * `<Link className={buttonVariants({ variant: 'secondary' })}>` directly.
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
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
