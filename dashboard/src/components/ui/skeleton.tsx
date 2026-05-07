import { cn } from "@/lib/utils";

/**
 * Single skeleton primitive used by every `loading.tsx` while server data loads.
 *
 * Tailwind 4 / CSS-variable based — `bg-muted` resolves to the theme token so
 * skeletons look right in light and dark mode without per-component overrides.
 * The `animate-pulse` class is the built-in tailwind keyframe; not adding a
 * custom shimmer to keep the bundle small.
 *
 * The full shadcn-style primitives layer (Button, Dialog, etc.) lands in #13;
 * this file is the bare minimum the loading scaffolding needs and the eventual
 * primitives sweep can absorb it without API changes.
 */
type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
