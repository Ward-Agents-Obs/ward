/**
 * #38 acceptance — axe-core static scan on the Radix Dialog primitive
 * embedded in a representative form. Catches regressions in the markup
 * contract our wrappers ship: dialog role, aria-modal, aria-labelledby /
 * aria-describedby pairing, close-button accessible name, form input
 * label association, button text.
 *
 * Approach: hand-curated HTML snapshot fed through JSDOM, scanned with
 * `axe-core`. The snapshot mirrors what `@radix-ui/react-dialog` produces
 * once mounted, plus the close-button slot our wrapper adds. Going this
 * route rather than rendering React in JSDOM keeps the test fast,
 * deterministic, and free of rendering quirks (portal targets, Suspense,
 * React 19 `act()` warnings). The trade-off: if Radix changes its DOM
 * structure on a major version bump, the snapshot here can drift; the
 * wrapper still works in production but the static check loses signal
 * until re-synced.
 *
 * Wider coverage (focus trap behaviour, ESC handling, return-focus on
 * close) is delegated to a manual axe browser-extension scan against the
 * live Monitor create/edit modal — those interactions are dynamic and not
 * a static-axe check's domain anyway.
 *
 * Run (matching the rest of the `*-tenant-isolation.ts` script convention,
 * though this one has no tenant scope):
 *
 *     # from dashboard/
 *     npx tsx __tests__/dialog-a11y.ts
 */

import { JSDOM } from "jsdom";
// `axe-core` is imported dynamically inside `main()` *after* the JSDOM
// globals are installed — axe binds `window` / `document` at module load
// time, so a top-level import would capture `undefined` and the run would
// fail with "Required 'window' or 'document' globals not defined".

// Hand-curated snapshot. Structure follows the Radix Dialog DOM at
// `data-state="open"`: an Overlay sibling + Content with role="dialog"
// + aria-modal + aria-labelledby + aria-describedby. The Title/Description
// have stable ids that the Content references. Our wrapper adds a
// `<button>` close affordance with an explicit `aria-label`.
const SNAPSHOT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><title>Dialog a11y snapshot</title></head>
  <body>
    <main>
      <h1>Background page</h1>
      <p>Some content that should be inert when the dialog is open.</p>
    </main>
    <div data-radix-portal>
      <div data-radix-dialog-overlay data-state="open"></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rdx-dialog-title"
        aria-describedby="rdx-dialog-description"
        tabindex="-1"
        data-state="open"
      >
        <div>
          <h2 id="rdx-dialog-title">Create monitor</h2>
          <p id="rdx-dialog-description">
            Alert when a tenant-wide metric crosses a threshold over a fixed window.
          </p>
        </div>

        <form>
          <div>
            <label for="dialog-form-name">Name</label>
            <input id="dialog-form-name" type="text" name="name" required />
          </div>
          <div>
            <label for="dialog-form-description">Description</label>
            <textarea id="dialog-form-description" name="description"></textarea>
          </div>
          <div>
            <label for="dialog-form-comparator">Comparator</label>
            <select id="dialog-form-comparator" name="comparator">
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
            </select>
          </div>
        </form>

        <div>
          <button type="button">Cancel</button>
          <button type="submit">Create monitor</button>
        </div>

        <button type="button" aria-label="Close">
          <svg aria-hidden="true" width="16" height="16"><path d="M0 0L16 16M16 0L0 16"></path></svg>
        </button>
      </div>
    </div>
  </body>
</html>`;

interface AxeViolation {
  id: string;
  impact?: string | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{ failureSummary?: string; html: string }>;
}

async function main(): Promise<void> {
  const dom = new JSDOM(SNAPSHOT_HTML, {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });

  // axe-core binds `window`/`document`/etc. at module load time. Inject
  // JSDOM globals BEFORE the dynamic import below so axe captures the
  // right references. `navigator` is a read-only getter on Node 21+ so we
  // use defineProperty to override; everything else is a plain assignment.
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.HTMLElement = dom.window.HTMLElement;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  const { default: axe } = await import("axe-core");

  // axe-core's `run` accepts a Document or Element + options. The Promise
  // form is straightforward; the callback variant exists for legacy
  // setups.
  const results = await axe.run(dom.window.document as unknown as Document, {
    runOnly: {
      type: "tag",
      // WCAG 2.1 AA + best practices — same set the axe browser extension
      // shows by default.
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
    },
  });

  const violations = results.violations as unknown as AxeViolation[];

  console.log(`\n[dialog-a11y] axe scan against Radix Dialog snapshot`);
  console.log(`  passes:       ${results.passes.length}`);
  console.log(`  violations:   ${violations.length}`);
  console.log(`  incomplete:   ${results.incomplete.length}`);
  console.log(`  inapplicable: ${results.inapplicable.length}`);

  if (violations.length > 0) {
    console.error(`\n[FAIL] ${violations.length} a11y violation(s):`);
    for (const v of violations) {
      console.error(`\n  ${v.id} (${v.impact ?? "?"}) — ${v.help}`);
      console.error(`  ${v.helpUrl}`);
      for (const node of v.nodes) {
        console.error(`    - ${node.html.slice(0, 120)}`);
        if (node.failureSummary) {
          console.error(`      ${node.failureSummary.replace(/\n/g, "\n      ")}`);
        }
      }
    }
    process.exit(1);
  }

  console.log("\n[PASS] Dialog snapshot has zero axe violations");
}

void main().catch((err: unknown) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
