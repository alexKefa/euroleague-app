import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { redeemPromoCodeForUser } from "../services/promoCodes.js";

export const promoCodesRouter = Router();

// The logged-in counterpart to registration's own promo-code handling
// (routes/auth.ts's POST /register) — for a code redeemed by someone who
// already has an account, e.g. a QR flyer scanned by an existing user
// (frontend/src/app/features/claim/claim.ts). One-time per user, enforced
// server-side by redeemPromoCodeForUser's claim-first insert — a repeat
// call with the same code is not an error, just reported back as
// "already_claimed" so the frontend can show a calm message instead of a
// failure state.
promoCodesRouter.post("/redeem", requireAuth, async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== "string" || code.trim().length === 0) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  try {
    const result = await redeemPromoCodeForUser(code, req.userId!);
    if (result === null) {
      res.status(404).json({ status: "invalid" });
      return;
    }
    if ("alreadyClaimed" in result) {
      res.status(200).json({ status: "already_claimed" });
      return;
    }
    res.status(200).json({
      status: "granted",
      packType: result.packType,
      quantity: result.quantity,
      bonusPoints: result.bonusPoints,
    });
  } catch (err) {
    console.error("POST /api/promo-codes/redeem failed:", err);
    res.status(500).json({ error: "Failed to redeem code" });
  }
});
