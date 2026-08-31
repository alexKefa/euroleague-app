import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { leagues } from "../db/schema.js";

// Same alphabet/length as users.referralCode (services/referrals.ts) —
// excludes 0/O and 1/I/L so a code meant to be read aloud or typed by hand
// doesn't hinge on telling those apart.
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/** A code not already in use by another league — collisions are astronomically unlikely at this length, but check anyway. */
export async function createUniqueLeagueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const [existing] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.code, code)).limit(1);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique league code");
}
