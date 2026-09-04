/**
 * Manual check that POST /api/auth/register actually caps abuse the way
 * routes/auth.ts's `credentialsLimiter` claims to (10 requests / 15min,
 * keyed by IP) — and that /login shares the exact same limiter instance,
 * so exhausting one blocks the other too. Fires real HTTP requests against
 * a running backend; doesn't touch the DB directly.
 *
 * Usage:
 *   npm run check:rate-limit                 # against local dev (npm run dev first)
 *   BASE_URL=https://clutchapp.up.railway.app npm run check:rate-limit
 *
 * Reuses one throwaway email across every register call — the first
 * succeeds and creates a real (junk) user row, every later attempt 409s as
 * "email taken" but still counts against the limiter (rate-limit middleware
 * runs before the handler, regardless of outcome), so this leaves only one
 * test account behind instead of ten.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";
const REGISTER_URL = `${BASE_URL}/api/auth/register`;
const LOGIN_URL = `${BASE_URL}/api/auth/login`;
const LIMIT = 10; // credentialsLimiter's `limit` in routes/auth.ts — keep in sync if that changes
const ATTEMPTS = LIMIT + 3; // a few past the cap, to confirm it actually holds rather than just delaying

const testEmail = `ratelimit-check-${Date.now()}@example.com`;

async function attempt(url: string, label: string, n: number): Promise<number> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: "testpass123" }),
  });
  const remaining = res.headers.get("ratelimit-remaining");
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  console.log(
    `${label} #${n}: ${res.status}${remaining !== null ? ` (remaining=${remaining})` : ""} — ${
      (body as { error?: string; code?: string }).error ?? (body as { code?: string }).code ?? "ok"
    }`,
  );
  return res.status;
}

async function main() {
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test email: ${testEmail}\n`);

  console.log(`-- firing ${ATTEMPTS} register attempts (limiter caps at ${LIMIT}/15min) --`);
  let firstBlockedAt: number | null = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const status = await attempt(REGISTER_URL, "register", i);
    if (status === 429 && firstBlockedAt === null) firstBlockedAt = i;
  }

  if (firstBlockedAt === null) {
    console.log(`\nFAIL: never got a 429 across ${ATTEMPTS} attempts — the limiter isn't blocking at all.`);
  } else if (firstBlockedAt !== LIMIT + 1) {
    console.log(`\nWARN: first 429 landed at attempt #${firstBlockedAt}, expected #${LIMIT + 1}.`);
  } else {
    console.log(`\nOK: limiter kicked in exactly at attempt #${firstBlockedAt}, as expected.`);
  }

  console.log(`\n-- confirming /login shares the same limiter (same IP, same 15min window) --`);
  const loginStatus = await attempt(LOGIN_URL, "login", 1);
  console.log(
    loginStatus === 429
      ? "OK: login is blocked too — register/login share one IP-keyed counter."
      : `WARN: login returned ${loginStatus}, expected 429 if register/login truly share a limiter instance.`,
  );

  console.log(
    `\nCleanup: this created one real user (${testEmail}) on attempt #1 — delete it from the DB by hand if you don't want it lingering. Every later attempt only 409'd, no extra rows.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
