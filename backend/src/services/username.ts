import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

// Six digits keeps the generated handle short and typeable while still
// giving ~900k possible suffixes — plenty for an app this size, same
// "astronomically unlikely, check anyway" spirit as createUniqueReferralCode.
function randomUsername(): string {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `clutch-user-${suffix}`;
}

/** A generated username not already in use. */
export async function createUniqueUsername(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = randomUsername();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (!existing) return username;
  }
  throw new Error("Could not generate a unique username");
}
