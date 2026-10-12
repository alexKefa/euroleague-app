// Production errors (2026-10-12): every console.error that carries an Error
// is also saved to error_events, so it outlives the deployment (Railway only
// keeps the running one's logs). Rather than touching ~215 call sites,
// console.error itself is wrapped once at startup; a request-scoped
// AsyncLocalStorage supplies the method, path and user of the request that
// failed. Saving is fire-and-forget and can never throw into the caller.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { errorEvents } from "../db/schema.js";

type Source = "route" | "job" | "process";

const requestStore = new AsyncLocalStorage<Request>();

// One row per fingerprint per minute, so a crash loop can't flood the table.
const THROTTLE_MS = 60_000;
const lastSaved = new Map<string, number>();
const MAX_STACK = 2048;
const RETENTION_DAYS = 30;

const originalConsoleError = console.error.bind(console);

/** Express middleware: remembers the request for any error logged while handling it. */
export function errorContext(req: Request, _res: Response, next: NextFunction): void {
  requestStore.run(req, next);
}

function fingerprintOf(message: string, stack: string | undefined): string {
  const frame = stack?.split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  // Numbers vary (ids, counts, ports); group "row 12" with "row 13".
  const key = `${message.replace(/\d+/g, "#")}|${frame.trim().replace(/:\d+:\d+\)?$/, "")}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

/** Saves one error. Never throws, never awaits the caller. */
export function reportError(source: Source, err: unknown, context?: string): void {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const message = (e.message || e.name || "Error").slice(0, 1000);
    const fingerprint = fingerprintOf(message, e.stack);
    const now = Date.now();
    if (now - (lastSaved.get(fingerprint) ?? 0) < THROTTLE_MS) return;
    lastSaved.set(fingerprint, now);
    if (lastSaved.size > 500) lastSaved.clear();

    const req = requestStore.getStore();
    db.insert(errorEvents)
      .values({
        source: req ? "route" : source,
        method: req?.method ?? null,
        path: req ? (req.originalUrl ?? req.url).split("?")[0].slice(0, 300) : null,
        context: context?.slice(0, 300) ?? null,
        message,
        stack: e.stack?.slice(0, MAX_STACK) ?? null,
        fingerprint,
        userId: (req as (Request & { userId?: string }) | undefined)?.userId ?? null,
      })
      .catch((saveErr: unknown) => originalConsoleError("[error report] could not save an error:", saveErr));
  } catch {
    // Reporting must never break the thing that failed.
  }
}

/**
 * Wraps console.error (an Error argument is saved, the line still prints as
 * before) and records crashes. Call once, before anything else runs.
 */
export function installErrorCapture(): void {
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const err = args.find((a) => a instanceof Error);
    if (!err) return;
    const context = args.filter((a) => typeof a === "string").join(" ") || undefined;
    reportError(requestStore.getStore() ? "route" : "job", err, context);
  };
  process.on("unhandledRejection", (reason) => {
    originalConsoleError("[unhandledRejection]", reason);
    reportError("process", reason, "unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    originalConsoleError("[uncaughtException]", err);
    reportError("process", err, "uncaughtException");
  });
}

/** Express error handler: the last app.use, for errors routes didn't catch. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  console.error(`[route] ${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong" });
}

/** Drops rows past the retention window (hourly job). */
export async function pruneErrorEvents(): Promise<void> {
  await db.delete(errorEvents).where(lt(errorEvents.at, sql`now() - make_interval(days => ${RETENTION_DAYS})`));
}

/** Errors grouped by fingerprint, most recent first (admin page). */
export async function listErrorGroups(days = 7) {
  return db.execute<{
    fingerprint: string;
    count: number;
    last_at: string;
    first_at: string;
    source: string;
    method: string | null;
    path: string | null;
    context: string | null;
    message: string;
    stack: string | null;
  }>(sql`
    select distinct on (fingerprint) fingerprint,
      count(*) over (partition by fingerprint)::int as count,
      max(at) over (partition by fingerprint) as last_at,
      min(at) over (partition by fingerprint) as first_at,
      source, method, path, context, message, stack
    from ${errorEvents}
    where at > now() - make_interval(days => ${days})
    order by fingerprint, at desc
  `);
}
