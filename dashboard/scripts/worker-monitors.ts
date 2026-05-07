/**
 * Local-dev / demo Monitor cron worker (#16 / B9).
 *
 * Long-running loop that POSTs `/api/cron/evaluate-monitors` every 5 minutes
 * with the configured `CRON_SECRET`. The route handler does the real work;
 * this script just provides the trigger signal in environments where Vercel
 * Cron isn't available (i.e. anywhere the dashboard isn't on Vercel).
 *
 * Run from `dashboard/`:
 *
 *     pnpm worker:monitors                  # uses TARGET=http://localhost:3001
 *     TARGET=http://dashboard:3001 \
 *       npm run worker:monitors             # alternate base URL
 *     INTERVAL_SEC=60 pnpm worker:monitors  # tighter cadence for testing
 *
 * Behaviour:
 *   - Reads `CRON_SECRET` from the loaded env (`--env-file=.env` or shell).
 *     Aborts with a clear message if missing — same code path as the route's
 *     503 response.
 *   - First tick fires immediately; subsequent ticks every `INTERVAL_SEC`.
 *   - Logs the route's JSON summary on each tick.
 *   - On non-2xx response, logs the body and continues. Network errors are
 *     logged and skipped — we'd rather drop a tick than crash the loop.
 *   - SIGINT/SIGTERM aware — clean shutdown without leaving the process
 *     dangling.
 *
 * Vercel Cron is the prod equivalent; see `dashboard/README.md` for the
 * `vercel.json` pattern. Don't run this script in prod alongside Vercel
 * Cron — they'll double-evaluate.
 */

const TARGET = process.env.TARGET ?? "http://localhost:3001";
const INTERVAL_MS = (Number(process.env.INTERVAL_SEC) || 5 * 60) * 1000;
const ENDPOINT = `${TARGET.replace(/\/+$/, "")}/api/cron/evaluate-monitors`;

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error(
    "[worker-monitors] CRON_SECRET not set — see dashboard/.env.example",
  );
  process.exit(2);
}

let stopping = false;

async function tick(): Promise<void> {
  const at = new Date().toISOString();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-cron-token": secret as string,
        "content-type": "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`[worker-monitors] ${at} ${res.status} ${res.statusText}: ${text}`);
      return;
    }

    // Try to parse JSON for nicer log output, but fall back to raw text.
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON — keep raw
    }
    console.log(`[worker-monitors] ${at} 200`, body);
  } catch (err) {
    console.error(`[worker-monitors] ${at} request failed:`, err);
  }
}

function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker-monitors] shutting down (${reason})`);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(
  `[worker-monitors] target=${ENDPOINT} interval=${INTERVAL_MS / 1000}s`,
);

void (async () => {
  // Fire immediately so a fresh start of the loop produces visible output
  // without waiting a full interval.
  await tick();
  while (!stopping) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    if (stopping) break;
    await tick();
  }
})();
