# Game Story Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every final game gets an auto-picked "story of the game" PNG (1080×1350, EN/EL), shareable from the game page and shown as the link preview of `/games/:id`.

**Architecture:** Pure angle-picking and copy modules (assert-checked) sit on top of a ≤3-statement fact loader. Rendering is satori → resvg with bundled WOFF fonts. Two routes serve a JSON summary and the PNG, with a bounded in-memory cache. The SPA fallback injects og/twitter tags for final games. The frontend adds one game-page card that reuses the existing `shareFile` helper.

**Tech Stack:** Express + Drizzle raw SQL, `satori@0.33.5`, `@resvg/resvg-js@2.6.2`, Angular 20 standalone + signals.

**Spec:** `docs/superpowers/specs/2026-10-09-game-story-cards-design.md`

## Global Constraints

- No schema changes. Fact loading ≤ 3 statements.
- No test suite: checks are `npx tsx src/scripts/check-*.ts` (node:assert), `npx tsc -p tsconfig.json --noEmit`, `npx ng build`, `curl` against a local backend started with `DATABASE_URL` = EuroleagueDev (verify the host contains `sparkling-pond`) and `DISABLE_BACKGROUND_JOBS=1`, on a free port, killed afterwards.
- Thresholds (verbatim from the spec):
  - Bench ≥ 35 pts or share ≥ 45%.
  - Lineup ≥ +10 in ≥ 360 s.
  - Explosion ≥ 28 pts or ≥ 32 PIR.
  - Comeback deficit ≥ 12.
  - Clutch margin ≤ 3 or OT.
- Score = value / threshold, and the highest wins. Tie order: bench, lineup, explosion, comeback, clutch. Fallback "game in numbers" has score 0.
- Card 1080×1350, white background, accent = the winner's primary colour (orange `#FF6B35` if luma < the ThemeService dark threshold), Sofia Sans 400/600 + Sofia Sans Condensed 800.
- All card text comes from `copy.ts` `{en, el}` templates. Lede variant = deterministic hash of the game id. Names render as "First Last".
- Link previews use `lang=el`. Image `Cache-Control: public, max-age=86400`. PNG cache = 60 entries, `clearStoryCache()` on final/stints syncs.
- Every new UI string goes in EN + EL. Frontend buttons use `appButton`. No browser automation; ask the user for phone checks.

## Review Focus

1. **Simulated/partial games:** no starter flags, no stints or no pbp. The relevant angles are skipped, the fallback still renders, and nothing crashes. → Task 1 check `missing data skips angles`; Task 4 renders a dev game with no stints.
2. **Overtime and huge names:** OT final scores and long names ("Nikola Kalinić-Marinković") must not overflow the 1080 width. → Task 3 renders a fixture with OT plus a 30-character name; look at the PNG.
3. **Greek text:** all EL templates are filled and render Greek glyphs, not boxes. → Task 2 check `no placeholder left` (EN/EL); Task 3 renders EL and looks at it.
4. **Logo fetch failure:** an unreachable logo URL falls back to a colour circle without failing the PNG. → Task 3 renders with a bogus logo URL.
5. **Non-final, unknown or non-UUID id:** both routes return 404 and the og tags are absent. → Task 4 and Task 5 curl checks.

---

### Task 1: Story types + angle picking (pure)

**Files:**
- Create: `backend/src/services/gameStory/types.ts`, `backend/src/services/gameStory/angles.ts`
- Create: `backend/src/scripts/check-game-story.ts`

**Interfaces — Produces:**
- `types.ts`:
  - `TeamFacts = { id; code; name; primaryColor: string | null; secondaryColor: string | null; logoUrl: string | null; score: number }`
  - `LineFacts = { playerCode; name /* "First Last" */; teamId; isStarter: boolean | null; points; rebounds; offRebounds; assists; steals; blocks; pir; plusMinus: number | null; minutes: number | null; fg2m; fg2a; fg3m; fg3a; ftm; fta; prevHighPoints: number | null; prevHighPir: number | null; last5Points: number[] }`
  - `StintFacts = { teamId; playerCodes: string[]; seconds; ptsFor; ptsAgainst; possFor; possAgainst }`
  - `MarginPoint = { t: number /* seconds elapsed */; margin: number /* home - away */ }`
  - `ClutchPlay = { t; period; clock; teamId; playerName; playType; homeScore; awayScore }`
  - `GameFacts = { gameId; season; round: number | null; tipoffAt: string; home: TeamFacts; away: TeamFacts; overtime: boolean; lines: LineFacts[]; stints: StintFacts[]; margins: MarginPoint[]; clutchPoints: { playerName: string; teamId: string; points: number }[]; clutchPlays: ClutchPlay[] }`
  - `Angle = "bench" | "lineup" | "explosion" | "comeback" | "clutch" | "numbers"`
  - `Story = { angle: Angle; score: number; data: BenchData | LineupData | ExplosionData | ComebackData | ClutchData | NumbersData }`, with each data type holding exactly what that angle's card body needs (spec "Card layout" §5).
- `angles.ts`:
  - `pickStory(f: GameFacts): Story`;
  - per-angle `evaluateBench | evaluateLineup | evaluateExplosion | evaluateComeback | evaluateClutch (f): Story | null`;
  - `lineupTypeRows(f, teamId): { label: "0-1" | "2-3" | "4-5"; seconds; ptsFor; ptsAgainst }[]`.
  - Constants exported: `BENCH_MIN_POINTS = 35`, `BENCH_MIN_SHARE = 0.45`, `LINEUP_MIN_PM = 10`, `LINEUP_MIN_SECONDS = 360`, `EXPLOSION_POINTS = 28`, `EXPLOSION_PIR = 32`, `COMEBACK_MIN = 12`, `CLUTCH_MAX_MARGIN = 3`.

- [ ] **Step 1: Failing checks** in `check-game-story.ts` (`check(name, fn)` style), built from a `baseFacts()` fixture helper:
  - `bench triggers at 35` (34 → null, 35 → score 1); `bench share rule` (30 of 60 points = 50% → score 0.5/0.45);
  - `lineup needs 360s and +10` (+12 in 300 s → null; +12 in 400 s → score 1.2);
  - `explosion uses larger ratio` (30 pts / 20 PIR → points headline; 20 pts / 40 PIR → PIR);
  - `career high only above previous` (prev 30, now 30 → no tag; 31 → tag);
  - `comeback from margins` (winner home, min margin −14 → deficit 14 → score 14/12);
  - `clutch margin or OT` (margin 2 → 1.5; margin 5 no OT → null; margin 5 OT → candidate);
  - `highest score wins, ties by table order`;
  - `fallback when nothing qualifies` → `angle "numbers"`, score 0;
  - `missing data skips angles` (all `isStarter` null → no bench; no stints → no lineup; no margins → no comeback; still returns a Story).
- [ ] **Step 2:** `cd backend && npx tsx src/scripts/check-game-story.ts` → fails importing `../services/gameStory/angles.js`.
- [ ] **Step 3: Implement** `types.ts` + `angles.ts`.
  - Winner = the higher score.
  - Bench = the winner's lines with `isStarter === false`.
  - Lineup = per (teamId, sorted playerCodes) sums over `stints`, picking the highest plus-minus with ≥ 360 s.
  - Net rating = 100·(pf/possFor − pa/possAgainst).
  - Comeback deficit = max over margins of −margin (home winner) or +margin (away winner).
- [ ] **Step 4:** the same command → all `ok`, exit 0.
- [ ] **Step 5: Commit:** `"Game stories: types and angle picking with checks"`.

---

### Task 2: Copy (EN/EL)

**Files:**
- Create: `backend/src/services/gameStory/copy.ts`
- Modify: `backend/src/scripts/check-game-story.ts` (add checks)

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `storyText(story: Story, f: GameFacts, lang: "en" | "el"): StoryText`.
  - `StoryText = { label; headline; lede; takeaway; context /* "EuroLeague 2026-27 · Round 4 · 8 October 2026" */; matchup /* "Home 92–74 Away" */; shareText; footnote: string | null; labels: Record<string, string> }`.
  - The `labels` keys are table/section headers used by render: `pointsSplit, benchScorers, byLineupType, bestLineup, starters, bench, min, score, pm, netRating, possessions, last5, shooting, keyPlays, keyTakeaway, topScorers`.

- [ ] **Step 1: Failing checks:**
  - `no placeholder left`: for every angle × `en`/`el`, no string in `storyText(...)` contains `{` or `}`, and none is empty;
  - `lede is deterministic`: the same game id gives the same lede twice, and two ids can differ;
  - `share text has link`: `shareText` contains `getclutchapp.com/games/<id>` and `#EuroLeague`.
- [ ] **Step 2:** run the check script → fails importing `copy.js`.
- [ ] **Step 3: Implement** `copy.ts`.
  - Templates are `{ en, el }` objects with 2–3 lede and takeaway variants per angle.
  - Variant = `hash(gameId) % n`, where hash = a sum of char codes.
  - Dates use `Intl.DateTimeFormat(lang === "el" ? "el-GR" : "en-GB", { timeZone: "Europe/Athens", day: "numeric", month: "long", year: "numeric" })`.
  - The footnote (net-rating definition) only for the lineup, bench and numbers angles.
- [ ] **Step 4:** the check script → all `ok`.
- [ ] **Step 5: Commit:** `"Game stories: EN/EL copy templates with checks"`.

---

### Task 3: Renderer + fonts

**Files:**
- Create: `backend/assets/fonts/SofiaSans-400.woff`, `SofiaSans-600.woff`, `SofiaSansCondensed-800.woff`. Download them from the `src:` URLs that `https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;600&family=Sofia+Sans+Condensed:wght@800` returns for the user agent `Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.112 Safari/534.30`. These are static, full-charset WOFF files, OFL-licensed.
- Create: `backend/assets/fonts/OFL.txt` (the SIL OFL text, Sofia Sans copyright line).
- Create: `backend/src/services/gameStory/render.ts`
- Create: `backend/src/scripts/render-story-sample.ts` (writes PNGs for visual checks)
- Modify: `backend/package.json` (`satori@0.33.5`, `@resvg/resvg-js@2.6.2`, exact versions)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `renderStoryPng(story: Story, f: GameFacts, text: StoryText): Promise<Buffer>`.
  - Fonts are read once from `path.resolve(process.cwd(), "assets/fonts")`.
  - Logos are fetched with a 3 s timeout, cached in a `Map<url, dataUri | null>`; null → colour circle.

- [ ] **Step 1: Write the sample script.** It builds hand-made fixtures:
  - one per angle;
  - plus an OT game with a 30-character name and a bogus logo URL;
  - EN and EL for the bench fixture.
  It runs `pickStory` → `storyText` → `renderStoryPng` and writes `.superpowers/sdd/2026-10-09-game-story-cards/samples/<name>.png (git-ignored)`.
- [ ] **Step 2:** run it → fails (no `render.js`).
- [ ] **Step 3: Implement `render.ts`.**
  - Build the satori element tree with plain objects (`{ type, props: { style, children } }`), following the spec's "Card layout" §1–7. Every angle body comes from `story.data`.
  - Resvg renders with `fitTo: { mode: "width", value: 1080 }`.
- [ ] **Step 4:** run the sample script → 8 PNGs written. **Open every PNG (Read tool) and check:**
  - no clipped or overflowing text;
  - Greek glyphs render, not boxes;
  - the OT game and the long name fit;
  - the bogus logo shows a colour circle;
  - each angle body matches the spec.
  Fix and re-render until all pass.
- [ ] **Step 5: Commit** (fonts, OFL, render, sample script, package files): `"Game stories: satori/resvg renderer with bundled Sofia Sans"`.

---

### Task 4: Facts loader, cache, routes

**Files:**
- Create: `backend/src/services/gameStory/facts.ts`, `backend/src/services/gameStory/index.ts`
- Modify: `backend/src/routes/games.ts` (two routes, next to `/:id/preview`)
- Modify: `backend/src/index.ts`: `clearStoryCache()` in `runLiveGamesSync` next to `invalidate(CACHE_KEYS.preview, CACHE_KEYS.lineup)`, and in `runGameExtrasSync` when `r.synced > 0`.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `loadGameFacts(gameId: string): Promise<GameFacts | null>` (null = unknown or not final), in ≤ 3 statements:
    1. the game, teams and lines with names, previous highs and last-5 points as subqueries;
    2. stints with the possession formula from `teamAnalytics.ts`;
    3. margins and clutch from `pbp_events` (margin after each scoring play; clutch = Q4 ≤ 300 s or OT with |margin before| ≤ 5).
  - `getStorySummary(gameId, lang): Promise<StorySummary | null>`, where `StorySummary = { angle; label; headline; lede; shareText }`.
  - `getStoryPng(gameId, lang): Promise<Buffer | null>`.
  - `clearStoryCache(): void`.
  - Routes `GET /api/games/:id/story?lang=` and `GET /api/games/:id/story.png?lang=`:
    - `lang` ∈ {en, el}, default `el`;
    - non-UUID, unknown or non-final → 404 `{ error }`;
    - the PNG gets `Content-Type: image/png` and `Cache-Control: public, max-age=86400`;
    - errors → 500 with `console.error("GET /api/games/:id/story.png failed:", err)`.

- [ ] **Step 1: RED.** Start the local backend on the dev DB (port 4010), pick a final dev game id from `/api/games/schedule`, and `curl -s -o /dev/null -w "%{http_code}" localhost:4010/api/games/<id>/story.png` → 404 (route missing).
- [ ] **Step 2: Implement** `facts.ts`, `index.ts` (bounded `Map` cache: on insert, delete the oldest key when size > 60), routes and cache clears.
- [ ] **Step 3: Verify:**
  - A final game: story.png → 200, `image/png`, cache header. Save the image, **open it**, and check the facts match the box score.
  - `/story?lang=en` and `?lang=el` → JSON with no `{`.
  - A scheduled game → 404; a random UUID → 404; `abc` → 404.
  - A dev game with no stints → still 200 (fallback or another angle).
  - Count statements by code read: ≤ 3.
- [ ] **Step 4: Commit:** `"Game stories: facts loader, cached PNG and summary routes"`.

---

### Task 5: Link previews + Docker assets

**Files:**
- Modify: `backend/src/index.ts`, the SPA fallback (`indexHtml`, ~line 163)
- Modify: `Dockerfile` (final stage: `COPY backend/assets ./assets`)

**Interfaces:**
- Consumes: `getStorySummary`.
- Produces: `/games/:id` HTML with the og/twitter tags for final games (spec "Link previews"). Tags are HTML-escaped. The image URL uses `APP_BASE_URL` or the request host; `lang=el`.

- [ ] **Step 1: RED:** `curl -s localhost:4010/games/<final id> | grep -c "og:image"` → `0`.

  Local dev has no built frontend under `public/`. Run `cd frontend && npx ng build` and copy `dist/euroleague-app-frontend/browser` to `backend/public` for this check only, and delete it after; check `.gitignore` first.
- [ ] **Step 2: Implement:**
  - read `index.html` once;
  - for `/games/:uuid`, await `getStorySummary(id, "el")`, inject the tags before `</head>`, and send;
  - otherwise, or on any error, send the plain file.
  - Add the Dockerfile line.
- [ ] **Step 3: Verify:**
  - final game → `og:image`, `twitter:card` and `og:image:width` present, with escaped title;
  - scheduled game → no `og:image`;
  - `/games/abc` → plain page.
  - `docker build` is not run locally. Instead, confirm the Dockerfile diff and that `assets/fonts` exists under `backend/`.
- [ ] **Step 4: Commit:** `"Game stories: link previews on /games/:id, ship fonts in the image"`.

---

### Task 6: Game page card + share

**Files:**
- Create: `frontend/src/app/features/game/game-story.ts`
- Create: `frontend/src/app/core/i18n/game-story.ts`; merge in `translations.ts`
- Modify: `frontend/src/app/core/models.ts` (`StorySummary`), `core/api.service.ts` (`getGameStory(gameId, lang)`), `features/game/game-detail.html/.ts` (render right under the score header when `d.game.status === 'final'`)

**Interfaces:**
- Consumes: the Task 4 routes; `shareFile` from `features/share-card/share-export.ts`.
- Produces: `<app-game-story [gameId] [homeCode] [awayCode] />`.

- [ ] **Step 1: Implement** per the spec "Frontend":
  - image `src` = `/api/games/<id>/story.png?lang=<i18n.lang()>`, with a skeleton until `load`, and the card hidden on `error`;
  - **Share:** `fetch` → blob → `File` → `shareFile`; `needsTap` shows a "tap again" button;
  - **Download:** filename `clutch-<home>-<away>-<angle>.png`;
  - **Copy link** with a "Link copied" note;
  - i18n keys `story.title, story.share, story.download, story.copyLink, story.linkCopied, story.tapAgain, story.error` (EN + EL).
- [ ] **Step 2: Verify:** `npx ng build` passes. Code read: strings are i18n'd, it fits 360px, and it only renders for final games.
- [ ] **Step 3: Commit:** `"Game stories: story card with share, download and copy link on the game page"`.

---

### Task 7: Ship to dev and hand off

- [ ] Run the `ship` skill for **dev**. Then, against the dev URL:
  - `curl` a final game's `story.png` (200, image/png) and the `/games/<id>` HTML (og:image present);
  - check the bundle contains `story.share`.
- [ ] Tell the user what changed. Ask them to:
  - share a card from their phone;
  - paste a dev game link into X/WhatsApp to see the preview;
  - send screenshots.
  Production only after their OK.
