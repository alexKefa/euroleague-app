# Share cards (Kit template)

Date: 2026-10-07 · Status: approved in conversation; the user asked to go straight to implementation.

## Goal

Fans make good-looking stat cards and post them to Instagram, X and
WhatsApp, so the app grows through sharing. Version 1 covers two card
types in one template ("Kit"):

- **Player card**: one player's stat line for a chosen period.
- **Head-to-head**: two players side by side for the same period.

Success means a fan can go from a player page or the Compare page to a
shared image in a few taps, and every image carries the Clutch mark and
`getclutchapp.com`.

## Constraints

- No backend or schema changes. All numbers come from
  `GET /api/players/:id/games` (`ApiService.getPlayerGames`).
- Images are produced in the browser (approach A from the conversation):
  the card is an Angular component turned into a PNG with `html-to-image`.
- Bilingual: every string in EN and EL in the same pass
  (`core/i18n/share-card.ts`). Stat abbreviations (PTS, REB…) stay
  untranslated, as elsewhere in the app.
- Team colours via each player's `team.primaryColor` / `secondaryColor`;
  text always uses the secondary colour on the primary background.
- Sofia Sans / Sofia Sans Condensed. Export waits for fonts to load.
- Guests can make and share cards; no login required.
- No new navigation item (phone nav stays 4 tabs + More).

## Entry points and route

- New route `/share` (lazy, standalone), no nav entry.
  - `?player=<id>` opens a player card.
  - `?a=<id>&b=<id>` opens a head-to-head (same param names as `/compare`).
- Player page (`/players/:id`): a "Make card" button near the player name,
  linking to `/share?player=<id>`.
- Compare page (`/compare`): a "Share comparison" button, shown when both
  players are selected, linking to `/share?a=<idA>&b=<idB>`.
- Back link: `navHistory.previousUrl() ?? '/stats'`.

## The maker page

One screen on a phone: preview on top, controls below.

1. **Preview**: the real card, rendered at full export size and scaled
   down with a CSS transform to fit the column.
2. **Period** chips: Season · Last 5 · Last game · vs Team.
   - vs Team opens a picker listing only opponents the player (in
     head-to-head: both players) actually faced this season.
   - A period with no games is disabled with a short note.
3. **Stats**: choose 3 to 5 from PTS, REB, AST, STL, BLK, TOV, PIR, MIN,
   2P%, 3P%, FT%. Default: PTS, REB, AST, PIR. With 5 selected, the other
   chips are disabled; with 3 selected, selected chips cannot be removed.
4. **Size**: Post (1080×1350) or Story (1080×1920).
5. **Share** button.
   - If `navigator.canShare({ files })` is true, open the share sheet with
     the PNG.
   - Otherwise download `clutch-<surname>-<period>.png`.
   - Cancelling the share sheet does nothing. Any other failure shows
     "Couldn't create the image" with a Try again button.

## Numbers

For the chosen period, over the player's games in that period:

- **Season / Last 5 / vs Team**: per-game averages, 1 decimal.
- **Last game**: the raw line, whole numbers.
- **MIN**: average minutes, 1 decimal (raw whole minutes for Last game).
- **2P% / 3P% / FT%**: total makes ÷ total attempts across the period,
  whole number with `%`; `–` when there are no attempts.
- Null stat values count as 0 for sums; games where the player has no
  minutes recorded (`minutes` null or 0) are excluded from all periods.
- **Last 5** is the 5 most recent games by tip-off; fewer if fewer exist.
- **Head-to-head winner** per stat: higher wins, except TOV where lower
  wins; equal values mark no winner. Both players use the same period;
  vs Team uses each player's own games against that team.

## The Kit card

Player card:
- Background `team.primaryColor`, all text `team.secondaryColor`
  (fallbacks: `#1f2937` / `#ffffff`).
- Shirt number (`jerseyNumber`) as a giant low-opacity watermark top
  right; the team code when the number is null.
- Player photo on the right (`photoUrl`, loaded with
  `crossorigin="anonymous"`). If it fails to load, the card renders
  without it.
- Top left: first name small, surname large in condensed uppercase, then a
  period pill.
- A stat strip across the bottom: 3 to 5 equal cells, value large, label
  small.
- Footer: Clutch wordmark left, `getclutchapp.com` right.

Head-to-head:
- Split vertically: left half player A's team colour, right half B's.
- Surnames at the top with "VS" between, team codes beneath.
- One line per stat: A value, label, B value; the winner's value is
  underlined.
- Footer: Clutch wordmark left, period label right.

Story size uses the same layout with more vertical room for the photo.

Period labels (EN / EL):
- Season: "Season 2026-27 · avg" / "Σεζόν 2026-27 · μ.ο."
- Last 5: "Last 5 games" / "Τελευταίοι 5 αγώνες" (or "Last {n} games" when
  fewer than 5).
- Last game: "Last game · vs {team}" / "Τελευταίος αγώνας · vs {team}".
- vs Team: "vs {team} · {n} games" / "vs {team} · {n} αγώνες".

## Components and files

All new frontend code lives in `frontend/src/app/features/share-card/`.

- `share-card.logic.ts`: pure, no Angular imports. Period filtering,
  stat-line computation, opponents faced, head-to-head winners, number
  formatting. Checked by `frontend/scripts/check-share-card.ts` (Node
  `assert`, run with the backend's `tsx`).
- `kit-card.ts`: presentational card (player or head-to-head), always
  rendered at 1080 px wide.
- `share-export.ts`: PNG export (wait for `document.fonts.ready` and the
  photo's decode, then `html-to-image`'s `toBlob`), share or download.
- `share-card-page.ts`: the `/share` page.
- `app.routes.ts`: the `/share` route.
- Player page and Compare page: the two buttons.
- `core/i18n/share-card.ts` (new) merged in `translations.ts`.
- `frontend/package.json`: add `html-to-image`.

## Verification

- `check-share-card.ts` passes.
- `ng build` and the backend type-check pass.
- Deploy to dev; the user shares a real card to Instagram from a phone
  (share sheets vary by device and cannot be checked from here).

## Out of scope

- Arena board and Trend sheet templates.
- Team-vs-team cards, "My season" cards, game recaps.
- Server-rendered images and link previews (approach B).
- Custom formula columns from the Analytics builder.
