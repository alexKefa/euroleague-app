# Game Story Cards — Design

Date: 2026-10-09
Status: approved in conversation, awaiting spec review

## Goal

Every final game gets an auto-generated, shareable "story of the game" image
in the style of the user's Box Out "Bench Impact" example. Any user can share
or download it from the game page, and a pasted game link previews the card
on X, WhatsApp, Facebook and Discord. Every image carries the Clutch logo and
getclutchapp.com, so each share advertises the app.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Content | Auto "story of the game": pick the most remarkable angle per game |
| Audience | Everyone, from the game page (no admin studio) |
| Rendering | Server-side PNG (satori + @resvg/resvg-js) |
| Link previews | `og:*` / `twitter:*` tags on `/games/:id` for final games |
| Size | 1080×1350 (post) |
| Languages | EN and EL; game page uses the viewer's language; link previews use the app default, **EL** |
| Copy | Fixed templates filled with numbers; no AI-written text |
| Schema | No changes |

## Angles

Each angle is a candidate only past its threshold. Its **score** is how far
past the threshold it went, as a ratio (`value / threshold`); the highest
score wins. Ties go in this table's order. **Game in numbers** is the
fallback, with score 0.

| # | Angle | Value (score input) | Threshold | Headline |
|---|---|---|---|---|
| 1 | Bench impact | the winner's bench points (non-starters); also a candidate if bench share ≥ 45% | ≥ 35 pts (share rule: score = share / 0.45) | "{n} BENCH POINTS" |
| 2 | Best lineup | best 5-man unit of either team by plus-minus, with ≥ 360 s | ≥ +10 | "+{net} NET RATING" |
| 3 | Player explosion | top player by points (≥ 28 pts) or PIR (≥ 32); take the larger ratio | 28 pts / 32 PIR | "{n} POINTS" or "PIR {n}"; tag "CAREER HIGH" if above every earlier game of his in `player_game_stats` |
| 4 | Comeback | the winner's largest deficit during the game (from `pbp_events` scores) | ≥ 12 | "DOWN {d}, WON BY {m}" |
| 5 | Clutch finish | final margin ≤ 3, or the game went to overtime; score = 3 / max(margin, 1), OT adds 1 | margin ≤ 3 or OT | "DECIDED IN THE FINAL SECONDS" / "WON IN OVERTIME" |
| 6 | Game in numbers | always | — | "{home} {hs}–{as} {away}" |

Details:
- Starters come from `player_game_stats.is_starter`. If a game has no starter flags (simulated games), Bench impact is not a candidate.
- Lineup stats come from that game's `lineup_stints`: summed seconds, points for/against, plus-minus, and net rating per 100 possessions (same possession estimate as `teamAnalytics.ts`). "Starters on court" for the by-lineup-type table = how many of the team's flagged starters are in the stint's five.
- Clutch hero = the player with the most points in the last 5:00 of Q4 or any OT while the score before the play was within 5 (the `teamAnalytics.ts` clutch definition).

## Card layout (1080×1350)

1. **Header:** Clutch logo, angle label (e.g. "BENCH IMPACT"), both team logos with the final score; winner bold.
2. **Hero:** giant headline in the winning team's colour (falls back to the app orange if that colour is near-black, the `ThemeService` rule).
3. **Context:** "{Home} {hs}–{as} {Away}" · "EuroLeague {season} · Round {r} · {date}" (Europe/Athens).
4. **Lede:** one templated sentence.
5. **Body, specific to the angle:**
   - **Bench impact:** a bench vs starters split bar (points and %), bench scorers (name, pts, one stat note: +/−, reb, ast or stl, highest first), and plus-minus by lineup type (0–1 / 2–3 / 4–5 starters on court: min, score, +/−).
   - **Best lineup:** the five names, minutes, score, +/−, net rating with ≈possessions; plus the by-lineup-type table for that team.
   - **Player explosion:** big pts/reb/ast/PIR row, the shooting line (2P, 3P, FT), and the last 5 games' points as mini bars.
   - **Comeback:** a score-margin line chart across the game (winner's perspective), with the low point marked.
   - **Clutch finish:** the last plays that changed the lead or tied the game in the final 2:00 / OT (time, player, play, score), up to 5.
   - **Game in numbers:** the top scorer of each team, the bench split for both teams, and the best lineup.
6. **Key takeaway:** one templated sentence, with a left accent bar.
7. **Footer:** "Net rating = points scored minus points allowed per 100 possessions." (only when shown) · **getclutchapp.com** · Clutch handle.

Colours: white background, near-black ink, accent = the winner's colour.
Fonts: Sofia Sans (body), Sofia Sans Condensed (headings, numbers).

## Copy (EN + EL)

All card text lives in `copy.ts` as `{en, el}` templates with `{name}`
placeholders: angle labels, headlines, ledes (2–3 variants per angle, chosen
by a deterministic hash of the game id so re-renders match), takeaways,
table headers, footer, and share text. Player names use the existing
"First Last" formatting (`normalizePlayerName`-style reorder of
"SURNAME, FIRST").

## Backend

### Modules: `backend/src/services/gameStory/`

- **`facts.ts`:** `loadGameFacts(gameId): Promise<GameFacts | null>` in ≤ 3 statements:
  1. the game, both teams, and box-score lines with player names;
  2. that game's lineup stints;
  3. play-by-play margins and clutch points, aggregated in SQL, plus each top-performer candidate's previous career highs (points, PIR).
  Returns null for an unknown or non-final game.
- **`angles.ts`** (pure): `pickStory(facts: GameFacts): Story`, where `Story = { angle, score, headline numbers, body data }`. Exports the per-angle evaluators for checks.
- **`copy.ts`** (pure): `storyText(story, facts, lang): StoryText` (label, headline, lede, takeaway, share text, table labels).
- **`render.ts`:** `renderStoryPng(story, facts, text): Promise<Buffer>`.
  - Builds a satori element tree (plain objects, no JSX) and renders with `@resvg/resvg-js` at 1080 px wide.
  - Fonts are loaded once from `backend/assets/fonts/` (SofiaSans 400/600, SofiaSansCondensed 800, TTF, OFL).
  - Team logos are fetched once per URL, cached in memory, and embedded as data URIs. On fetch failure they fall back to a colour circle.
- **`index.ts`:** `getStoryPng(gameId, lang)` and `getStorySummary(gameId, lang)`.
  - A bounded cache keeps the **60** most recent PNGs (oldest dropped), keyed by `gameId:lang`. `clearStoryCache()` empties it, and `backend/src/index.ts` calls it wherever a game's stats or stints can change: the live-games sync when games go final, and after `syncMissingGameExtras` writes stints. So a late correction re-renders.
  - `getStorySummary` returns `{ angle, label, headline, lede, shareText }`.

### Routes (`routes/games.ts`)

- `GET /api/games/:id/story?lang=en|el` → `StorySummary` | 404 for non-final or unknown games.
- `GET /api/games/:id/story.png?lang=en|el` → `image/png` with `Cache-Control: public, max-age=86400`, or 404.
  - `lang` defaults to `el`. Invalid ids get 404, using the same UUID guard as `/:id/preview`.

### Link previews (`backend/src/index.ts` SPA fallback)

- For `GET /games/:id`, where the id is a UUID and the game is final, serve `index.html` with these tags injected before `</head>`:
  - `og:title` (= headline + teams) and `og:description` (= lede);
  - `og:image` = `https://<host>/api/games/:id/story.png?lang=el`, with `og:image:width` 1080 and `og:image:height` 1350;
  - `og:url`;
  - `twitter:card=summary_large_image`, plus `twitter:title`, `twitter:description` and `twitter:image`.
- The host comes from `APP_BASE_URL`, falling back to the request host.
- Everything else gets the plain file, as today.
- `index.html` is read once at startup.
- On any lookup error, the plain file is served.

## Frontend

- `ApiService.getGameStory(gameId, lang)` → `StorySummary`.
- **New `features/game/game-story.ts`** (standalone), rendered in `game-detail.html` right under the score header for final games only:
  - a card titled "Story of the game" with the image (`/api/games/:id/story.png?lang=<viewer lang>`), a skeleton while loading, and hidden on error;
  - buttons:
    - **Share:** fetch the PNG into a `File`, then the existing `shareFile` (`features/share-card/share-export.ts`). On `needsTap`, show the existing "tap again" prompt pattern. The share text and link come from `StorySummary.shareText`.
    - **Download:** `clutch-<home>-<away>-<angle>.png`.
    - **Copy link:** `navigator.clipboard.writeText(<origin>/games/:id)`, then a "Link copied" note.
- **i18n** (new `core/i18n/game-story.ts`, EN + EL): title, share, download, copy link, link copied, tap again, error.

## Dependencies

- `satori` and `@resvg/resvg-js`, pinned to exact versions at least two weeks old.
- Docker base is `node:22` (Debian, glibc), which matches resvg's `linux-x64-gnu` prebuilt.
- The fonts are committed under `backend/assets/fonts/` and copied into the image. The Dockerfile must include that folder.

## Verification

1. `backend/src/scripts/check-game-story.ts` (node:assert), using hand-made `GameFacts`:
   - each angle triggers at its threshold and not below it;
   - the highest score wins, and ties follow the table order;
   - the fallback is used when nothing qualifies;
   - Bench impact is skipped without starter flags;
   - a career-high tag appears only above previous highs;
   - the comeback deficit comes from the margins;
   - copy fills every placeholder in EN and EL (no `{` left).
2. Render real dev games locally to PNG files: one per angle where dev has one, and both languages. **Look at them** before shipping.
3. `curl` `/games/:id` locally for a final game (og tags present) and a scheduled game (absent); `curl` both story endpoints (200/404, content type, cache header).
4. Backend `tsc`, `ng build`. Ship to dev; the user tests Share on a phone and pastes a game link into X/WhatsApp for the preview.

## Out of scope

The story (9:16) size, an admin content studio, a choice of angle by the user, video, and auto-posting to social accounts.
