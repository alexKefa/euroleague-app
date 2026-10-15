# Round Clips — Design

Date: 2026-10-15
Status: approved design, not built

## Goal

Grow signups through TikTok and Instagram Reels. No user has ever posted
from the app and no signup has come from a referral (39 non-admin users,
0 referred), so the app owner is the distribution channel: after each
round, an admin page turns that round's real data into a ~18-second
vertical video, in English or Greek, ready to post.

Success: 2–3 postable clips per round with minimal effort, and signups
from them measurable through a promo code on the bio link
(`getclutchapp.com/register?promo=TIKTOK`, already supported).

## What the user decided

- Direction: a per-round recap mixed with a pack-opening payoff.
- Hook: **D** — open on the round's biggest upset in the community's picks
  while a face-down card sits on screen, promising a pull at the end.
- Both languages, chosen per export.
- Real stats, never invented, but **no usernames**: each featured player
  is shown as a catchy alias built from their real result and their
  favourite team's city.
- Rendered in the browser on an admin page (option 1), exported silent so
  a trending sound can be added inside TikTok/Instagram.

## The clip (~18 s, 1080×1920, 30 fps)

| # | Time | Scene | Content |
|---|---|---|---|
| 1 | 0–2 s | Hook | "78% of Clutch players said / OLYMPIACOS / THEY LOST 81–87". Glow in the losing team's colour. Face-down card wobbling, "🔒 legendary pull at the end". |
| 2 | 2–6 s | Results | "Round 6": every final score slams in, one by one, with team logos, in tip-off order. Small face-down card in the corner. |
| 3 | 6–9 s | Top predictor | "The Oracle of Piraeus · 9/10 · +214 pts". |
| 4 | 9–12 s | Bold call | "Only 12% said / FENERBAHCE / and they won 90–88", then "The Lone Wolf of Belgrade". |
| 5 | 12–16 s | Payoff | The card flips with a burst: the legendary pulled this round, player photo, "Golden Hands of Athens". |
| 6 | 16–18 s | Call to action | "Think you'd do better?", "Round 7 picks are open", getclutchapp.com, "Free · link in bio". Holds still, so the last frame works as a cover. |

Greek copy mirrors English, phrased so team names stay in the nominative
(no declension table needed): "Το 78% των παικτών του Clutch είπε /
ΟΛΥΜΠΙΑΚΟΣ / ΕΧΑΣΕ 81–87", "🔒 legendary κάρτα στο τέλος", "Αγωνιστική 6",
"Κορυφαίος προβλέπων", "Μόνο το 12% είπε / ΦΕΝΕΡΜΠΑΧΤΣΕ / και κέρδισε 90–88",
"Την τράβηξε…", "Εσύ θα τα πήγαινες καλύτερα;", "Άνοιξαν οι προβλέψεις ·
Αγωνιστική 7", "Δωρεάν · link στο bio". Round names come from the existing
round-label mapping (rounds 39+ are Play-in / Playoffs · Game N / Final
Four), so postseason clips work unchanged.

When a scene is skipped, the timeline closes the gap; the clip gets shorter
rather than showing an empty scene.

### Aliases

`<title> <of city>` — the title from the scene, the city from the
featured user's favourite team. No favourite team → title alone.

| Scene | EN | EL |
|---|---|---|
| Top predictor | The Oracle of Piraeus | Ο Μάντης του Πειραιά |
| Bold call | The Lone Wolf of Belgrade | Ο Μοναχικός Λύκος του Βελιγραδίου |
| Payoff | Golden Hands of Athens | Χρυσά Χέρια της Αθήνας |

A lookup table keyed by `teams.code` (the DB has no Greek names and
`teams.city` is empty) gives each club a short name in English and Greek
("Olympiacos" / "Ολυμπιακός") and its city for the alias ("of Piraeus" /
"του Πειραιά"). Kept server-side next to the endpoint. A club missing from
the table falls back to `teams.name` and a title-only alias.

## Data: `GET /api/admin/round-clip?season=&round=`

`requireAuth` + `requireAdmin`. 409 with a readable message unless every
game in the round is final. Returns everything the clip needs; images are
embedded as data URIs (team logos and player photos come from EuroLeague's
CDN, and a cross-origin image would block canvas recording). Usernames and
user ids never leave the server.

Selection rules (admins excluded everywhere):

- **Hook (upset)**: the game with the largest share of picks on the loser,
  among games with ≥ 5 picks and that share > 50%. Returns the share, the
  loser, the winner and the score.
  Fallback 1: no such game → the hook uses the bold call's text.
  Fallback 2: fewer than 5 picks on every game → the biggest upset by
  pre-game odds (`game_odds`), shown without a percentage.
- **Results**: all games of the round, tip-off order, codes, logos, scores.
- **Top predictor**: #1 of `getRoundStandings(season, round)`; correct,
  total, points, alias. Skipped when nobody picked.
- **Bold call**: the game with the smallest share of correct pickers (≥ 5
  picks, ≥ 1 correct); one correct picker's alias. Skipped when it is the
  hook's game.
- **Payoff**: legendaries in `user_collectibles` with `unlocked_at` inside
  the round's window (from the previous round's last tip-off to 24 h after
  this round's last tip-off). Rarest first: foil legendary (`finish = 'foil'`), legendary, then
  the best rare as a fallback. Card name, player photo, tier, finish,
  alias. Nothing at all → a generic "Open packs free in Clutch" payoff so
  the hook's promise still resolves.
- **Call to action**: the next round number and whether its picks are open.

A failed image fetch returns `null` for that image; the renderer draws the
team code or player initials instead.

## Frontend: `/admin/clips`

Linked from `/admin/tools`. Admin-only like the other admin routes.

- Round picker (finished rounds, newest first), EN/EL toggle, a looping
  preview at phone proportions, and **Export MP4** with a recording
  progress bar. Downloads `clutch-<season>-round-<n>-<lang>.mp4`
  (`.webm` when MP4 isn't available, with a note).
- Clip wording lives in its own EN/EL table and follows the toggle, not
  the app's language.

Files in `features/admin/clips/`, one job each:

| File | Job |
|---|---|
| `round-clip-page.ts` | The page and its controls. |
| `clip-timeline.ts` | Which scenes run and when, gap-closing for skipped scenes, per-element easing. No drawing. |
| `clip-renderer.ts` | `draw(ctx, data, t, lang)` for one instant on a 1080×1920 canvas. Used by both preview and export. |
| `clip-recorder.ts` | Plays the timeline in real time and records `canvas.captureStream(30)` with `MediaRecorder` (~8 Mbps); MP4 (`video/mp4;codecs=avc1`) when supported, else WebM. |
| `clip-text.ts` | The clip's EN/EL strings. |

Look: the app's near-black ground, Sofia Sans / Sofia Sans Condensed 800,
brand orange `#f0761c`, a glow in the hook's team colour, scores slamming
in, the corner card wobbling, a flip with a light burst at the payoff.
Fonts (including Greek glyphs) are awaited with `document.fonts.load`
before the first frame. Text auto-shrinks to fit its box.

## Errors and edge cases

- Round not final → 409; the picker only lists finished rounds.
- No hook scene (no upset and no bold call qualified) → the page warns
  before export that the clip opens without a hook.
- `MediaRecorder` unavailable → Export disabled: "Use desktop Chrome or
  Safari".
- Tab hidden during recording (browsers throttle animation) → recording
  stops and asks to export again with the tab in front.

## Testing

No test suite in this repo.

- `npx tsc -p tsconfig.json --noEmit` (backend), `ng build` (frontend).
- Call the endpoint on the dev DB for a finished round and check each
  scene's pick against a hand-written SQL query for that round.
- Export EN and EL, play both, upload one as a private TikTok draft.
- Check the fallbacks on a round with no legendary pull and a round with
  few picks.

## Out of scope

Auto-posting, user-facing clip export, music, the app's social handle,
pack-opening-only clips.
