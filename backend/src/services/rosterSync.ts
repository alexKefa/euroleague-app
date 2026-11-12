// Roster sync (2026-10-12): who plays for which club, from the live
// club-roster feed. A TS port of sync-py/roster_sync.py so production keeps
// rosters current on its own; before this, rosters only changed when
// someone ran the Windows-only Python script by hand, and the hourly
// season-stats sync can't cover for it because its feed leaves out
// low-minute players (Marcio Santos moved TEL -> BAS in September and was
// still listed at TEL in October).
//
// Rules (same as roster_sync.py, plus the `active` fix):
// - Only "Player" entries the feed marks active count. A player who moved
//   clubs appears twice — active at the new club, inactive at the old one —
//   and taking both let the old entry win whenever its club synced later.
// - Each rostered player is upserted: team, name, position, number, photo
//   (an existing photo is kept when the feed has none), active = true.
// - Each club's head coach ("Coach", not "Assitant coach") is updated.
// - A player attached to a club we fetched but on no current roster is
//   marked inactive; team_id stays (box scores and season stats keep it).
// - A club the feed doesn't return is left alone, players included.
// - Cards (services/collectiblePlayers.ts): unlinked cards get linked to
//   their player, cards follow a moved player, a new signing gets a common
//   and a rare.
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams } from "../db/schema.js";
import { getCurrentSeason } from "./season.js";
import { createCardsForNewPlayers, linkCollectiblesToPlayers } from "./collectiblePlayers.js";

interface ClubPerson {
  typeName: string;
  active?: boolean;
  dorsal?: string | null;
  positionName?: string | null;
  person?: { code?: string; name?: string; images?: Record<string, string | null> };
  images?: Record<string, string | null>;
}

interface RosterEntry {
  code: string;
  name: string;
  teamId: string;
  position: string | null;
  jerseyNumber: number | null;
  photoUrl: string | null;
}

export interface RosterSyncResult {
  season: string;
  teamsFetched: number;
  teamsSkipped: string[];
  playersOnRosters: number;
  moved: { name: string; from: string | null; to: string }[];
  added: { name: string; team: string }[];
  deactivated: { name: string; team: string | null }[];
  coachChanges: { team: string; from: string | null; to: string | null }[];
  /** Series-1 cards whose team_id/image_url were moved to their player's current club. */
  cardsMoved: number;
  /** Players who just got a common + rare card (or would, in a dry run). */
  cardsCreated: { name: string; team: string }[];
}

function photoOf(entry: ClubPerson): string | null {
  for (const images of [entry.images, entry.person?.images]) {
    if (!images) continue;
    if (images.action) return images.action;
    for (const value of Object.values(images)) if (value) return value;
  }
  return null;
}

function dorsal(value: string | null | undefined): number | null {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isNaN(n) ? null : n;
}

async function fetchClub(seasonCode: string, clubCode: string): Promise<ClubPerson[] | null> {
  try {
    const res = await fetch(`https://api-live.euroleague.net/v2/competitions/E/seasons/${seasonCode}/clubs/${clubCode}/people?type=J`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as ClubPerson[]) : null;
  } catch {
    return null;
  }
}

/** Pulls every club's roster and, unless dryRun, writes it. Returns what changed. */
export async function syncRosters(opts: { dryRun?: boolean } = {}): Promise<RosterSyncResult> {
  const season = await getCurrentSeason();
  if (!season) throw new Error("no season in games");
  const seasonCode = `E${season.split("-")[0]}`;

  const teamRows = await db.select({ id: teams.id, code: teams.code, headCoach: teams.headCoach }).from(teams);
  const teamCode = new Map(teamRows.map((t) => [t.id, t.code]));

  const fetched: { id: string; code: string; headCoach: string | null; coach: string | null }[] = [];
  const skipped: string[] = [];
  const roster = new Map<string, RosterEntry>(); // player code -> entry
  for (const t of teamRows) {
    const people = await fetchClub(seasonCode, t.code);
    if (!people) {
      skipped.push(t.code);
      continue;
    }
    const coach = people.find((e) => e.typeName === "Coach")?.person?.name ?? null;
    fetched.push({ id: t.id, code: t.code, headCoach: t.headCoach, coach });
    for (const e of people) {
      const code = e.person?.code;
      if (e.typeName !== "Player" || e.active !== true || !code || !e.person?.name) continue;
      roster.set(code, {
        code,
        name: e.person.name,
        teamId: t.id,
        position: e.positionName ?? null,
        jerseyNumber: dorsal(e.dorsal),
        photoUrl: photoOf(e),
      });
    }
  }

  // Only compare against clubs we actually got data for.
  const fetchedIds = new Set(fetched.map((t) => t.id));
  const existing = await db
    .select({ id: players.id, code: players.code, name: players.name, teamId: players.teamId, active: players.active })
    .from(players);
  const byCode = new Map(existing.map((p) => [p.code, p]));

  const moved: RosterSyncResult["moved"] = [];
  const added: RosterSyncResult["added"] = [];
  const transfers: { playerId: string; fromTeamId: string; toTeamId: string }[] = [];
  for (const r of roster.values()) {
    const p = byCode.get(r.code);
    if (!p) added.push({ name: r.name, team: teamCode.get(r.teamId)! });
    else if (p.teamId !== r.teamId) {
      moved.push({ name: r.name, from: teamCode.get(p.teamId) ?? null, to: teamCode.get(r.teamId)! });
      transfers.push({ playerId: p.id, fromTeamId: p.teamId, toTeamId: r.teamId });
    }
  }
  const deactivated = existing
    .filter((p) => p.active && fetchedIds.has(p.teamId) && !roster.has(p.code))
    .map((p) => ({ name: p.name, team: teamCode.get(p.teamId) ?? null }));
  const coachChanges = fetched
    .filter((t) => t.coach !== null && t.coach !== t.headCoach)
    .map((t) => ({ team: t.code, from: t.headCoach, to: t.coach }));

  let cardsMoved = 0;
  // A new signing gets a common + rare. In a dry run this lists players
  // already in the table who still lack cards (new arrivals aren't inserted yet).
  let cardsCreated = opts.dryRun ? await createCardsForNewPlayers([...fetchedIds], { dryRun: true }) : [];
  if (!opts.dryRun && roster.size > 0) {
    // One upsert for every rostered player.
    const rows = [...roster.values()].map(
      (r) => sql`(${r.code}, ${r.teamId}::uuid, ${r.name}, ${r.position}, ${r.jerseyNumber}::int, ${r.photoUrl}, true)`
    );
    await db.execute(sql`
      insert into players (code, team_id, name, position, jersey_number, photo_url, active)
      values ${sql.join(rows, sql`, `)}
      on conflict (code) do update set
        team_id = excluded.team_id,
        name = excluded.name,
        position = excluded.position,
        jersey_number = excluded.jersey_number,
        photo_url = coalesce(excluded.photo_url, players.photo_url),
        active = true
    `);
    // Everyone on a fetched club who is on no roster now.
    const ids = sql.join([...fetchedIds].map((id) => sql`${id}::uuid`), sql`, `);
    const codes = sql.join([...roster.keys()].map((c) => sql`${c}`), sql`, `);
    await db.execute(sql`
      update players set active = false
      where active = true and team_id in (${ids}) and code not in (${codes})
    `);
    if (transfers.length > 0) {
      const values = transfers.map((t) => sql`(${t.playerId}::uuid, ${t.fromTeamId}::uuid, ${t.toTeamId}::uuid, ${season})`);
      await db.execute(sql`
        insert into player_transfers (player_id, from_team_id, to_team_id, season)
        values ${sql.join(values, sql`, `)}
      `);
    }
    await linkCollectiblesToPlayers();
    // Series-1 cards follow their player. Runs every sync, not only on a
    // detected move, so a move made by hand (roster_sync.py, SQL) heals too.
    // The new club's photo replaces the old one; a player with no photo yet
    // keeps the card's current image. Moments (series 2) keep the team of
    // the game they capture.
    cardsMoved = (
      await db.execute(sql`
        update collectibles c
        set team_id = p.team_id, image_url = coalesce(p.photo_url, c.image_url)
        from players p
        where c.player_id = p.id and c.series = 1 and p.active and c.team_id <> p.team_id
        returning c.id
      `)
    ).length;
    cardsCreated = await createCardsForNewPlayers([...fetchedIds]);
    if (coachChanges.length > 0) {
      const values = fetched.filter((t) => t.coach !== null).map((t) => sql`(${t.id}::uuid, ${t.coach})`);
      await db.execute(sql`
        update teams set head_coach = v.coach
        from (values ${sql.join(values, sql`, `)}) as v(id, coach)
        where teams.id = v.id
      `);
    }
  }

  return {
    season,
    teamsFetched: fetched.length,
    teamsSkipped: skipped,
    playersOnRosters: roster.size,
    moved,
    added,
    deactivated,
    coachChanges,
    cardsMoved,
    cardsCreated,
  };
}
