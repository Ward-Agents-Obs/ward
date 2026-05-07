import { cn } from "@/lib/utils";

/**
 * Prompt + completion side-by-side viewer. Replaces the raw JSON dump that
 * the V1.0 trace-detail page used. Either side may be missing (some
 * providers don't emit one of the attributes for streamed responses), so
 * we render structurally consistent panes with empty-state captions.
 *
 * Server component — pure presentation, no state.
 */

interface PromptCompletionPaneProps {
  prompt?: string | null;
  completion?: string | null;
  className?: string;
}

export function PromptCompletionPane({
  prompt,
  completion,
  className,
}: PromptCompletionPaneProps) {
  return (
    <div className={cn("grid gap-4 md:grid-cols-2", className)}>
      <Pane title="Prompt" body={prompt} emptyCaption="No prompt captured for this span." />
      <Pane
        title="Completion"
        body={completion}
        emptyCaption="No completion captured for this span."
      />
    </div>
  );
}

function Pane({
  title,
  body,
  emptyCaption,
}: {
  title: string;
  body: string | null | undefined;
  emptyCaption: string;
}) {
  return (
    <div className="rounded-[1.5rem] border tech-border bg-panel p-5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h3>
      {body ? (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-background p-4 text-xs leading-relaxed text-foreground">
          {body}
        </pre>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{emptyCaption}</p>
      )}
    </div>
  );
}
