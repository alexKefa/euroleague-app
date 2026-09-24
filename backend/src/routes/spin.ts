import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { wheelSpins, ownedPacks } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { PACKS, PackType } from "../services/packs.js";

export const spinRouter = Router();

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Daily reset now means the calendar day, not a rolling 24h-since-last-spin
// window (2026-09-25, direct request: "should reset at 00:00 of the day,
// not every 24hr") — a user who spins at 23:50 could spin again at 00:00
// ten minutes later, not have to wait until 23:50 the next day. Athens is
// the one timezone this app already treats as canonical for a "day"
// elsewhere (every game/round/date display already formats in
// "Europe/Athens" — see game-detail.html, schedule.html, etc.), so this
// reuses that same convention rather than UTC or a per-user timezone,
// which this app has no concept of anyway.
const SPIN_RESET_TIMEZONE = "Europe/Athens";

// Athens' actual UTC offset at a given instant, in minutes — reads it via
// Intl rather than hardcoding +2/+3, since which one applies flips twice a
// year (EET/EEST) and Node's tz database already knows the real transition
// dates.
function athensOffsetMinutesAt(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: SPIN_RESET_TIMEZONE, timeZoneName: "shortOffset" }).formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const match = raw.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) * 60 : 120;
}

// The UTC instant of the next Athens midnight strictly after `after`. Not
// exact across the 1-2 calendar days/year Greece's clocks actually change
// (the offset used is read at an approximate guess instant, not the true
// target — a fixed-point refinement would close that gap, but being off by
// up to an hour on 2 days a year for a "come back tomorrow" wheel reset
// isn't worth the extra complexity).
function nextAthensMidnightUtc(after: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SPIN_RESET_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    after
  );
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  // "Y-M-(D+1) 00:00", built as if it were UTC — Date.UTC normalizes a
  // day/month past the end of the month on its own, so this is safe across
  // a month/year rollover too.
  const nextDayAsUtc = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const offsetMinutes = athensOffsetMinutesAt(nextDayAsUtc);
  return new Date(nextDayAsUtc.getTime() - offsetMinutes * 60_000);
}
// Every spin gives *something* — a flat "90% of spins give nothing" felt
// bad for a once-a-day mechanic and didn't reward showing up. These odds
// pick which wheel-exclusive pack (services/packs.ts) the spin grants —
// unopened, into owned_packs — rather than a tier to roll on the spot; the
// user opens it later from the Packs page's inventory, whenever they want.
//
// 65/25/10 -> 63/23/14 (2026-08-25, "album completable in a season" pass):
// simulating the real pity mechanics against the 208-common/208-rare/
// 22-legendary catalog showed legendary was the last bottleneck once
// wheelStarter/wheelPro were made rare-heavy (see the slots comment in
// services/packs.ts) — commons and rares were reliably finishing by ~day
// 165-190 of a ~210-day season, but legendary's old 10%/day rate only
// expects ~21 pulls across a season against 22 needed, so plenty of runs
// fell 1-2 short right at the finish line. Bumping to 14% (~29 expected
// pulls/season) fixed that without making legendary feel routine — see
// scripts/economy-report.ts's LEGENDARY_CHANCE-derived pacing math, which
// updates automatically from this constant.
// 63/23/14 -> 58/20/14/8 (2026-09-03, coach cards added): legendary is the
// tightest completion bottleneck (see the 2026-08-25 pass above) — an
// earlier attempt at this change shaved legendary 14->11 to make room for
// coach and re-simulating showed a real regression (85%-engagement,
// 50-65% accuracy full-album completion dropped from the documented
// ~91-98%/day~160-181 down to 57-70%/day~179-185). Reverted legendary back
// to its exact original 14% and took coach's 8% out of common+rare instead
// (63->58, 23->20) — both tiers already reliably hit 100% completion well
// before season end regardless (see the "commons+rares only" column below),
// so a few points off their wheel share costs comparatively little.
//
// 58/20/14/8 -> 58/20/20/2 (2026-09-22): the legendary catalog doubled from
// 20 to 40 cards (replace-legendary-catalog.ts — 2 "brand name" players per
// team by real season PIR instead of 1) with no other change, which
// collapsed 50%-engagement full-album completion back to 0-4% across every
// accuracy — the same bottleneck this file's history already describes,
// just worse. Legendary's share went 14->20, taken entirely out of coach's
// share (8->2) rather than common's or rare's — coach isn't in the album,
// so this is a free lever, unlike every previous odds change here which had
// to trade off against commons/rares. Combined with the same-pass milestone
// retune (services/cards.ts's LEGENDARY_MILESTONE_INTERVAL/
// FANTASY_MILESTONE_INTERVAL, see that file's comments for the full before/
// after numbers) and a matching Elite-pack-odds bump (services/packs.ts),
// restored 50%-engagement completion to 37/72/89/96/99/100% — matching or
// exceeding the original 22-card numbers — with commons/rares completely
// unaffected. Coach supply dropped moderately as the one real tradeoff
// (not album-tracked). Re-run economy:simulate after any future change.
export const SPIN_ODDS = { common: 0.58, rare: 0.2, legendary: 0.2, coach: 0.02 } as const;
export const LEGENDARY_CHANCE = SPIN_ODDS.legendary;
export const COACH_CHANCE = SPIN_ODDS.coach;

const WHEEL_PACK_BY_TIER: Record<keyof typeof SPIN_ODDS, PackType> = {
  common: "wheelStarter",
  rare: "wheelPro",
  legendary: "wheelLegendary",
  coach: "wheelCoach",
};

function rollSpinTier(): "common" | "rare" | "legendary" | "coach" {
  const roll = Math.random();
  if (roll < SPIN_ODDS.coach) return "coach";
  if (roll < SPIN_ODDS.coach + SPIN_ODDS.legendary) return "legendary";
  if (roll < SPIN_ODDS.coach + SPIN_ODDS.legendary + SPIN_ODDS.rare) return "rare";
  return "common";
}

async function getSpinStatus(userId: string) {
  const [last] = await db
    .select({ spunAt: wheelSpins.spunAt })
    .from(wheelSpins)
    .where(eq(wheelSpins.userId, userId))
    .orderBy(desc(wheelSpins.spunAt))
    .limit(1);

  if (!last) return { canSpin: true, nextEligibleAt: null };

  const nextEligibleAt = nextAthensMidnightUtc(new Date(last.spunAt));
  const canSpin = Date.now() >= nextEligibleAt.getTime();
  return { canSpin, nextEligibleAt: canSpin ? null : nextEligibleAt };
}

spinRouter.get("/", requireAuth, async (req, res) => {
  try {
    res.json(await getSpinStatus(req.userId!));
  } catch (err) {
    console.error("GET /api/spin failed:", err);
    res.status(500).json({ error: "Failed to load spin status" });
  }
});

spinRouter.post("/", requireAuth, async (req, res) => {
  try {
    const status = await getSpinStatus(req.userId!);
    if (!status.canSpin) {
      res.status(429).json({ error: "Come back later for your next spin", nextEligibleAt: status.nextEligibleAt });
      return;
    }

    const rolledTier = rollSpinTier();
    const packType = WHEEL_PACK_BY_TIER[rolledTier];

    const [wonPack] = await db.transaction(async (tx) => {
      await tx.insert(wheelSpins).values({ userId: req.userId! });
      return tx.insert(ownedPacks).values({ userId: req.userId!, packType }).returning();
    });

    res.status(201).json({
      // No card yet — the pack sits unopened in the user's inventory
      // (GET /api/packs/owned) until they open it themselves from the
      // Packs page via POST /api/packs/owned/:id/open.
      wonPack: { id: wonPack.id, packType, label: PACKS[packType].label, tier: rolledTier },
      nextEligibleAt: nextAthensMidnightUtc(new Date()),
    });
  } catch (err) {
    console.error("POST /api/spin failed:", err);
    res.status(500).json({ error: "Failed to spin" });
  }
});

// Admin-only debug tool for testing the win visual — grants a legendary
// pack straight into the inventory, bypassing the odds roll, and
// deliberately doesn't touch wheelSpins, so it never counts against or
// resets the real 24h cooldown. Still opened through the normal My Packs
// flow, so this exercises the real open path too, not just the win banner.
spinRouter.post("/cheat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [wonPack] = await db.insert(ownedPacks).values({ userId: req.userId!, packType: "wheelLegendary" }).returning();
    res.status(201).json({
      wonPack: { id: wonPack.id, packType: "wheelLegendary", label: PACKS.wheelLegendary.label, tier: "legendary" },
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin" });
  }
});

// Same debug tool as /cheat above, for the coach pool instead — otherwise
// verifying the jade card visual means waiting on an 8% wheel / 5.5%
// elite-pack-slot chance.
spinRouter.post("/cheat-coach", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [wonPack] = await db.insert(ownedPacks).values({ userId: req.userId!, packType: "wheelCoach" }).returning();
    res.status(201).json({
      wonPack: { id: wonPack.id, packType: "wheelCoach", label: PACKS.wheelCoach.label, tier: "coach" },
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat-coach failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin coach" });
  }
});

// Same debug tool as /cheat above, plus forceFoil — otherwise a foil is
// still just a FOIL_CHANCE coin flip on open, same as any real legendary
// pull, which defeats the point of a button meant to reliably show the
// foil visual/verify foil-dependent features (trades, inventory, etc.).
spinRouter.post("/cheat-foil", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [wonPack] = await db
      .insert(ownedPacks)
      .values({ userId: req.userId!, packType: "wheelLegendary", forceFoil: true })
      .returning();
    res.status(201).json({
      wonPack: { id: wonPack.id, packType: "wheelLegendary", label: PACKS.wheelLegendary.label, tier: "legendary" },
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat-foil failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin foil" });
  }
});
