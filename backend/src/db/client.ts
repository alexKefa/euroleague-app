import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

// Neon works over a normal Postgres connection. This is a single persistent
// Node process (not per-request serverless functions), so a pool of 1
// forced every query in the whole app onto one shared connection —
// concurrent requests (e.g. a page firing several API calls at once, each
// themselves issuing several queries) queued up behind each other instead
// of running in parallel, adding real multi-second latency under any
// concurrent load. DATABASE_URL points at Neon's pooled (PgBouncer)
// endpoint, which comfortably handles more than one connection.
// `idle_timeout` closes connections proactively before Neon's proxy drops
// them server-side — without it, postgres.js can hand out a dead socket
// whose reset arrives with no query attached to catch it, crashing the process.
// Pool of 7 (2026-10-29): prod's Supabase session pooler allows 15 clients
// in total, and a Railway deploy runs the old and new instance side by side
// for a moment. At 10 each that overlap hit EMAXCONNSESSION; 2 x 7 = 14 fits.
// 2026-10-30: each reconnect re-runs postgres.js's type lookup (~420 rows);
// at 20s that was ~1,400 reconnects a day on Supabase, counted as egress.
// Supabase's session pooler keeps idle clients, so prod holds them 4 min;
// Neon (dev) keeps the 20s that guards against its proxy dropping them.
const idleTimeout = connectionString.includes("pooler.supabase.com") ? 240 : 20;
const client = postgres(connectionString, { max: 7, ssl: "require", idle_timeout: idleTimeout });

export const db = drizzle(client, { schema });
