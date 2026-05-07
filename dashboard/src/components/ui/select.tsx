import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select primitive — V1 wraps the native HTML <select> with consistent
 * styling. The richer popover-based Select (search, multi-select, virtualised
 * options) requires `@radix-ui/react-select` and is deferred until architect
 * approves the dep. For our V1 surfaces (filter chips on /traces) the native
 * widget is plenty.
 *
 * Usage:
 *   <Select value={env} onChange={(e) => setEnv(e.target.value)}>
 *     <option value="">All environments</option>
 *     <option value="prod">prod</option>
 *   </Select>
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          "h-10 appearance-none rounded-lg border tech-border bg-background pl-3 pr-9 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
);
Select.displayName = "Select";
