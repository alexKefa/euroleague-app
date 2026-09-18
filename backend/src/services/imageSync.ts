/**
 * Shared core of scripts/sync-roster-photos.ts and
 * scripts/sync-collectible-images.ts, extracted (2026-09-18) so the admin
 * "Sync images" button (routes/admin.ts's POST /admin/sync-images) can run
 * the exact same tested logic instead of duplicating it — previously this
 * two-step pipeline ("pull new real photos from the live feed, then push
 * them into matching cards") only ever ran when someone asked for it to be
 * run by hand from a terminal.
 *
 * Both scripts still exist and still work standalone (their own --dry-run/
 * --team flags call into here too), they just no longer own the core
 * fetch/diff/write logic themselves.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams, collectibles } from "../db/schema.js";

const SEASON = 2026; // 2026-27 — bump alongside roster_sync.py's own default each season

interface ClubPerson {
  typeName: string;
  person?: { code?: string; images?: Record<string, string | null> };
  images?: Record<string, string | null>;
}

function extractPhotoUrl(entry: ClubPerson): string | null {
  for (const images of [entry.images, entry.person?.images]) {
    if (!images) continue;
    if (images.action) return images.action;
    for (const value of Object.values(images)) {
      if (value) return value;
    }
  }
  return null;
}

export interface RosterPhotoSyncResult {
  playersFound: number;
  coachesFound: number;
  teamsChecked: number;
  playerUpdates: { code: string; from: string | null; to: string }[];
  coachCardUpdates: { name: string; from: string | null; to: string }[];
}

/** Pulls real player/coach photos from the live club-roster feed and, unless dryRun, writes them. */
export async function syncRosterPhotos(opts: { teamCode?: string; dryRun?: boolean } = {}): Promise<RosterPhotoSyncResult> {
  const allTeamRows = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const teamRows = opts.teamCode ? allTeamRows.filter((t) => t.code === opts.teamCode) : allTeamRows;

  const photoByCode = new Map<string, string>();
  const coachPhotoByTeamId = new Map<string, string>();
  for (const { id: teamId, code } of teamRows) {
    const url = `https://api-live.euroleague.net/v2/competitions/E/seasons/E${SEASON}/clubs/${code}/people?type=J`;
    const res = await fetch(url);
    if (!res.ok) continue; // team not found in this season's feed (e.g. AS Monaco)
    const people = (await res.json()) as ClubPerson[];
    if (!Array.isArray(people)) continue;
    for (const entry of people) {
      if (entry.typeName === "Player" && entry.person?.code) {
        const photoUrl = extractPhotoUrl(entry);
        if (photoUrl) photoByCode.set(entry.person.code, photoUrl);
      } else if (entry.typeName === "Coach") {
        const photoUrl = extractPhotoUrl(entry);
        if (photoUrl) coachPhotoByTeamId.set(teamId, photoUrl);
      }
    }
  }

  const existingPlayers = await db.select({ code: players.code, photoUrl: players.photoUrl }).from(players);
  const playersToUpdate = existingPlayers.filter((p) => photoByCode.has(p.code) && p.photoUrl !== photoByCode.get(p.code));

  const existingCoachCards = await db
    .select({ id: collectibles.id, teamId: collectibles.teamId, name: collectibles.name, imageUrl: collectibles.imageUrl })
    .from(collectibles)
    .where(eq(collectibles.tier, "coach"));
  const coachCardsToUpdate = existingCoachCards.filter(
    (c) => coachPhotoByTeamId.has(c.teamId) && c.imageUrl !== coachPhotoByTeamId.get(c.teamId)
  );

  if (!opts.dryRun) {
    if (playersToUpdate.length > 0) {
      const values = playersToUpdate.map((p) => sql`(${p.code}, ${photoByCode.get(p.code)!})`);
      await db.execute(sql`
        update players
        set photo_url = v.photo_url
        from (values ${sql.join(values, sql`, `)}) as v(code, photo_url)
        where players.code = v.code
      `);
    }
    for (const c of coachCardsToUpdate) {
      await db
        .update(collectibles)
        .set({ imageUrl: coachPhotoByTeamId.get(c.teamId)! })
        .where(and(eq(collectibles.id, c.id), eq(collectibles.tier, "coach")));
    }
  }

  return {
    playersFound: photoByCode.size,
    coachesFound: coachPhotoByTeamId.size,
    teamsChecked: teamRows.length,
    playerUpdates: playersToUpdate.map((p) => ({ code: p.code, from: p.photoUrl, to: photoByCode.get(p.code)! })),
    coachCardUpdates: coachCardsToUpdate.map((c) => ({ name: c.name, from: c.imageUrl, to: coachPhotoByTeamId.get(c.teamId)! })),
  };
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function displayName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  const toTitle = (s: string) => s.split(/\s+/).map(titleCase).join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface CollectibleImageSyncResult {
  collectibleUpdates: { name: string; from: string | null; to: string }[];
  totalCollectibles: number;
}

/** Pushes players.photoUrl into any matching collectible whose image_url has fallen behind, unless dryRun. */
export async function syncCollectibleImages(opts: { dryRun?: boolean } = {}): Promise<CollectibleImageSyncResult> {
  const allPlayers = await db.select().from(players);
  const photoByKey = new Map<string, string>();
  for (const p of allPlayers) {
    if (!p.photoUrl) continue;
    photoByKey.set(`${p.teamId}::${normalize(displayName(p.name))}`, p.photoUrl);
  }

  const allCollectibles = await db
    .select({ id: collectibles.id, name: collectibles.name, teamId: collectibles.teamId, imageUrl: collectibles.imageUrl })
    .from(collectibles);

  const toUpdate = allCollectibles
    .map((c) => ({ c, photoUrl: photoByKey.get(`${c.teamId}::${normalize(c.name)}`) }))
    .filter((row): row is { c: (typeof allCollectibles)[number]; photoUrl: string } => !!row.photoUrl && row.photoUrl !== row.c.imageUrl);

  if (!opts.dryRun && toUpdate.length > 0) {
    const values = toUpdate.map((row) => sql`(${row.c.id}, ${row.photoUrl})`);
    await db.execute(sql`
      update collectibles
      set image_url = v.image_url
      from (values ${sql.join(values, sql`, `)}) as v(id, image_url)
      where collectibles.id = v.id::uuid
    `);
  }

  return {
    collectibleUpdates: toUpdate.map((row) => ({ name: row.c.name, from: row.c.imageUrl, to: row.photoUrl })),
    totalCollectibles: allCollectibles.length,
  };
}
