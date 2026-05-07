import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Card primitive set. Replaces the inline panel patterns scattered across
 * V1 surfaces (every page hero, every chart panel, every nested KPI box).
 *
 * Variants are chosen to match the three densities already in use:
 *   - `panel`  (default) — chart cards, filter rows, sidebar callouts.
 *                          rounded-2xl, border, bg-panel, p-6.
 *   - `hero`            — page-top headers ("Workspace / Tracing").
 *                          rounded-[2rem], border, bg-panel, p-8, shadow-sm.
 *   - `inset`           — nested boxes inside a panel/hero card (KPI substats,
 *                          collapsible sections in the monitor modal).
 *                          rounded-2xl, border, bg-background, p-4.
 *
 * Subcomponents (`CardHeader` / `CardTitle` / `CardDescription` / `CardContent`
 * / `CardFooter`) match the shadcn/ui shape so existing patterns can migrate
 * idiomatically.
 */
const cardVariants = cva("border tech-border", {
  variants: {
    variant: {
      panel: "rounded-2xl bg-panel p-6",
      hero: "rounded-[2rem] bg-panel p-8 shadow-sm",
      inset: "rounded-2xl bg-background p-4",
    },
  },
  defaultVariants: { variant: "panel" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, className }))}
      {...props}
    />
  )
);
Card.displayName = "Card";

/**
 * Slot for header content (eyebrow + title + description). Use inside a
 * `<Card>` to keep typographic spacing consistent across surfaces.
 */
export const CardHeader = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1.5", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-sm font-medium tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("mt-4", className)} {...props} />
));
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-4 flex items-center", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { cardVariants };
