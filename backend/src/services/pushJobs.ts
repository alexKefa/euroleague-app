import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getCurrentSeason } from "./season.js";
import { getDefaultRound, getRoundLockTime } from "./fantasyScoring.js";
import { getPlayedRounds, getRoundStandings } from "./roundStandings.js";
import { GREAT_ROUND_THRESHOLD } from "./cards.js";
import { pushEnabled, sendPushOnce } from "./push.js";

// Scheduled push notifications (2026-10-05), run from index.ts's hourly tick
// (and round results also whenever a game goes final). Each send is deduped
// through push_log (sendPushOnce), so overlapping runs are harmless.

// Picks: games tipping off within this window that you haven't picked. The
// tick is hourly, so a game gets its reminder 2-3h before tipoff.
const PICKS_WINDOW_MS = 3 * 60 * 60 * 1000;
// Fantasy: the round locks within this window and you have no squad.
const FANTASY_WINDOW_MS = 6 * 60 * 60 * 1000;
// Round results only go out for a round that finished recently, so the first
// deploy (or a long outage) doesn't announce old rounds.
const RESULTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function athensDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
}

/** "Games soon without your pick" and "build your Fantasy squad before it locks". */
export async function runLockReminderPushes(): Promise<number> {
  if (!pushEnabled) return 0;
  let sent = 0;

  // One statement: every subscribed user with unpicked games in the window.
  const unpicked = await db.execute<{ user_id: string; unpicked: number }>(sql`
    select s.user_id, count(*)::int as unpicked
    from (select distinct user_id from push_subscriptions) s
    cross join games g
    where g.status = 'scheduled'
      and g.tipoff_at > now() and g.tipoff_at <= now() + ${`${PICKS_WINDOW_MS / 1000} seconds`}::interval
      and not exists (select 1 from predictions p where p.game_id = g.id and p.user_id = s.user_id)
    group by s.user_id
  `);
  if (unpicked.length) {
    const counts = new Map(unpicked.map((r) => [r.user_id, r.unpicked]));
    sent += await sendPushOnce("picks-reminder", athensDateKey(), [...counts.keys()], (lang, userId) => {
      const n = counts.get(userId) ?? 0;
      return {
        title: lang === "el" ? "Οι προβλέψεις κλειδώνουν σύντομα" : "Picks lock soon",
        body:
          lang === "el"
            ? n === 1 ? "Ένας αγώνας ξεκινά σε λίγες ώρες χωρίς πρόβλεψή σου." : `${n} αγώνες ξεκινούν σε λίγες ώρες χωρίς πρόβλεψή σου.`
            : n === 1 ? "A game tips off in a few hours without your pick." : `${n} games tip off in a few hours without your pick.`,
        url: "/predictions",
        tag: "picks-reminder",
      };
    });
  }

  const season = await getCurrentSeason();
  const round = season ? await getDefaultRound(season) : null;
  const lockAt = season && round !== null ? await getRoundLockTime(season, round) : null;
  const now = Date.now();
  if (season && round !== null && lockAt && lockAt.getTime() > now && lockAt.getTime() - now <= FANTASY_WINDOW_MS) {
    const noSquad = await db.execute<{ user_id: string }>(sql`
      select distinct s.user_id from push_subscriptions s
      where not exists (select 1 from fantasy_lineups l where l.user_id = s.user_id and l.season = ${season} and l.round = ${round})
    `);
    sent += await sendPushOnce("fantasy-reminder", `${season}:${round}`, noSquad.map((r) => r.user_id), (lang) => ({
      title: lang === "el" ? `Fantasy Five: Αγωνιστική ${round}` : `Fantasy Five: Round ${round}`,
      body: lang === "el" ? "Δεν έχεις φτιάξει πεντάδα και η αγωνιστική κλειδώνει σύντομα." : "You haven't picked a squad and the round locks soon.",
      url: "/fantasy",
      tag: "fantasy-reminder",
    }));
  }
  return sent;
}

/** "Round N is done: X/Y correct, +P points" to everyone who picked in it. */
export async function runRoundResultPushes(): Promise<number> {
  if (!pushEnabled) return 0;
  const season = await getCurrentSeason();
  if (!season) return 0;
  const { lastComplete, lastCompleteAt } = await getPlayedRounds(season);
  if (lastComplete === null || !lastCompleteAt || Date.now() - new Date(lastCompleteAt).getTime() > RESULTS_MAX_AGE_MS) return 0;

  const standings = await getRoundStandings(season, lastComplete, { includeAdmins: true });
  const byUser = new Map(standings.map((s) => [s.userId, s]));
  return sendPushOnce("round-results", `${season}:${lastComplete}`, [...byUser.keys()], (lang, userId) => {
    const s = byUser.get(userId);
    if (!s) return null;
    const great = s.correct >= GREAT_ROUND_THRESHOLD;
    return {
      title: lang === "el" ? `Αποτελέσματα αγωνιστικής ${lastComplete}` : `Round ${lastComplete} results`,
      body:
        lang === "el"
          ? `${s.correct}/${s.total} σωστές, +${s.points} πόντοι.${great ? " Σε περιμένει ανταμοιβή!" : ""}`
          : `${s.correct}/${s.total} correct, +${s.points} points.${great ? " A reward is waiting for you!" : ""}`,
      url: "/predictions",
      tag: "round-results",
    };
  });
}
