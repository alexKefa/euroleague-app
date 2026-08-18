import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "./tokens.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}

/** Must run after requireAuth — relies on req.userId being set. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, req.userId!)).limit(1);
  if (!user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}