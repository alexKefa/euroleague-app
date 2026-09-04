import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { teamsRouter } from "./routes/teams.js";
import { standingsRouter } from "./routes/standings.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { playersRouter } from "./routes/players.js";
import { newsRouter } from "./routes/news.js";
import { gamesRouter } from "./routes/games.js";
import { predictionsRouter } from "./routes/predictions.js";
import { collectiblesRouter } from "./routes/collectibles.js";
import { spinRouter } from "./routes/spin.js";
import { tradesRouter } from "./routes/trades.js";
import { packsRouter } from "./routes/packs.js";
import { eventsRouter } from "./routes/events.js";
import { analyticsViewsRouter } from "./routes/analyticsViews.js";
import { leaguesRouter } from "./routes/leagues.js";
import { injuriesRouter } from "./routes/injuries.js";
import { syncNews } from "./sync/newsSync.js";
import { syncOdds } from "./sync/oddsSync.js";

const app = express();
// Railway sits in front of the app as a single reverse-proxy hop, adding
// its own X-Forwarded-For. Without this, express-rate-limit's default
// validation sees an X-Forwarded-For header arrive while Express doesn't
// trust any proxy, decides the header could be spoofed by the client, and
// throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR — this was previously flagged
// as just a noisy console warning, but escalated to a hard failure on a
// recent deploy. `1` (trust exactly one hop) is correct here, not `true`
// (trust the whole chain) — that would let a client set its own
// X-Forwarded-For and spoof past IP-based rate limiting entirely.
// TODO(env-split): this is unconditional today, but there's genuinely no
// proxy hop in local dev — so a script talking to the dev server directly
// can set its own X-Forwarded-For and it gets trusted anyway, bypassing
// per-IP rate limiting locally (not exploitable on Railway itself, since
// Railway's own edge proxy overwrites/appends before this app ever sees
// the header). Split this to `process.env.NODE_ENV === "production" ? 1 :
// false` (or similar) once there's a real reason to trust dev-local rate
// limiting numbers — same underlying idea (a production vs. development
// posture) probably applies to other settings across this app that are
// currently one-size-fits-all, not just this line; worth a pass over
// index.ts and the security-relevant middleware here more broadly.
app.set("trust proxy", 1);
const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Populated by the Railway build (see ./Dockerfile) by copying the
// Angular build's browser/ output here — absent in local dev, where the
// frontend is served separately by `ng serve` instead.
const staticDir = path.join(__dirname, "../public");

app.use(
  helmet({
    // Same-origin by default; the frontend needs Google Fonts (styles.css),
    // remote EuroLeague CDN images (team logos, player photos), and inline
    // script/style — Angular's build injects a first-party inline <script>
    // in index.html (stamps the color scheme before Angular loads, to
    // avoid a flash of the wrong theme) plus an inline onload= handler for
    // async-loading critical CSS. Both are build-time-generated, not user
    // input, so 'unsafe-inline' here isn't opening up arbitrary injection.
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
      },
    },
  })
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "euroleague-app-backend" });
});

app.use("/api/teams", teamsRouter);
app.use("/api/standings", standingsRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/players", playersRouter);
app.use("/api/news", newsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/predictions", predictionsRouter);
app.use("/api/collectibles", collectiblesRouter);
app.use("/api/spin", spinRouter);
app.use("/api/trades", tradesRouter);
app.use("/api/packs", packsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/analytics-views", analyticsViewsRouter);
app.use("/api/leagues", leaguesRouter);
app.use("/api/injuries", injuriesRouter);

// Serves the built Angular app (see ./Dockerfile) — absent in local dev,
// where the frontend runs separately via `ng serve` on its own port.
const indexHtml = path.join(staticDir, "index.html");
if (fs.existsSync(indexHtml)) {
  app.use(express.static(staticDir));
  // SPA fallback: any non-API route hands off to Angular's client-side
  // router. /api/* paths that don't match a router above still 404 normally.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

app.listen(port, () => {
  console.log(`euroleague-app-backend listening on http://localhost:${port}`);
});

// Production-only: this process stays up indefinitely (unlike local dev,
// which restarts on every file save under tsx watch — running this there
// too would re-hit both RSS feeds on every save while actively editing).
// Both feeds are plain public RSS, no auth/rate-limit concerns at this
// cadence — 10 minutes is a normal polling interval for a feed reader.
if (process.env.NODE_ENV === "production") {
  const NEWS_SYNC_INTERVAL_MS = 10 * 60 * 1000;
  const runNewsSync = () => {
    syncNews()
      .then(({ articlesUpserted, feedsFailed }) => {
        console.log(`[news sync] upserted ${articlesUpserted} articles${feedsFailed.length ? `, failed: ${feedsFailed.join(", ")}` : ""}`);
      })
      .catch((err) => console.error("[news sync] failed:", err));
  };
  runNewsSync();
  setInterval(runNewsSync, NEWS_SYNC_INTERVAL_MS);

  // Odds-weighted prediction scoring (services/points.ts's
  // pointsForCorrectPick) — a no-op every run until ODDS_API_KEY is set
  // (see sync/oddsSync.ts), so this is safe to always run rather than
  // gating the interval itself on the env var being present. Each run only
  // fetches games that don't already have a game_odds snapshot (see that
  // table's schema comment), so most runs after the first catch-up do
  // little-to-no work — a few times a day is plenty to catch new games as
  // they enter the sync window, well within a free-tier request quota.
  const ODDS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const runOddsSync = () => {
    syncOdds()
      .then(({ gamesMatched, gamesSkipped, unmatchedTeamNames }) => {
        if (gamesMatched === 0 && gamesSkipped === 0) return; // nothing pending, not worth a log line
        console.log(`[odds sync] matched ${gamesMatched} games, skipped ${gamesSkipped}${unmatchedTeamNames.length ? `, unmatched teams: ${unmatchedTeamNames.join(", ")}` : ""}`);
      })
      .catch((err) => console.error("[odds sync] failed:", err));
  };
  runOddsSync();
  setInterval(runOddsSync, ODDS_SYNC_INTERVAL_MS);
}