import { db } from "../db/client.js";
import { teams, teamSeasonStats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getStandings } from "./euroleagueClient.js";
import { colorsForTeam } from "./teamColors.js";

/**
 * Converts a EuroLeague season year (e.g. 2025 for the 2025-26 season)
 * into the "2025-26" format stored in team_season_stats.season.
 */
function seasonLabel(season: number): string {
  const endYear = String(season + 1).slice(-2);
  return `${season}-${endYear}`;
}

export async function syncStandings(season: number) {
  const standings = await getStandings(season);
  const season_ = seasonLabel(season);

  let teamsUpserted = 0;
  let statsUpserted = 0;

  for (const row of standings) {
    const code = row.club.code;
    const colors = colorsForTeam(code);

    const [team] = await db
      .insert(teams)
      .values({
        code,
        name: row.club.name,
        city: row.club.city ?? null,
        primaryColor: colors.primary,
        secondaryColor: colors.secondary,
      })
      .onConflictDoUpdate({
        target: teams.code,
        set: { name: row.club.name, city: row.club.city ?? null },
      })
      .returning();
    teamsUpserted++;

    const ppg = row.gamesPlayed > 0 ? row.pointsFavour / row.gamesPlayed : null;
    const papg = row.gamesPlayed > 0 ? row.pointsAgainst / row.gamesPlayed : null;

    const existing = await db
      .select({ id: teamSeasonStats.id })
      .from(teamSeasonStats)
      .where(and(eq(teamSeasonStats.teamId, team.id), eq(teamSeasonStats.season, season_)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(teamSeasonStats)
        .set({ wins: row.win, losses: row.loss, ppg, papg })
        .where(eq(teamSeasonStats.id, existing[0].id));
    } else {
      await db.insert(teamSeasonStats).values({
        teamId: team.id,
        season: season_,
        wins: row.win,
        losses: row.loss,
        ppg,
        papg,
      });
    }
    statsUpserted++;
  }

  return { teamsUpserted, statsUpserted };
}
