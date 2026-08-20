import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

// Neon works over a normal Postgres connection; `max: 1` keeps this
// friendly to serverless-style deploys, bump it later if needed.
// `idle_timeout` closes connections proactively before Neon's proxy drops
// them server-side — without it, postgres.js can hand out a dead socket
// whose reset arrives with no query attached to catch it, crashing the process.
const client = postgres(connectionString, { max: 1, ssl: "require", idle_timeout: 20 });

export const db = drizzle(client, { schema });
