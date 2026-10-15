# Round Clips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin page that turns a finished round into an ~18 s vertical MP4 (EN or EL) for TikTok/Reels.

**Architecture:** One admin endpoint assembles the round's clip data (pure selection functions over a few SQL results, images inlined as data URIs, aliases instead of usernames). The Angular page builds a scene timeline from that data, draws any instant onto a 1080×1920 canvas, previews it in a loop, and records it in real time with `MediaRecorder`.

**Tech Stack:** Express + Drizzle (`db.execute(sql…)`), Angular 20 standalone + signals, Canvas 2D, `MediaRecorder`. Pure logic tested with `node:test` run through `npx tsx --test` (no new dependencies; the repo has no test runner, so these test files are the only tests).

**Spec:** `docs/superpowers/specs/2026-10-15-round-clip-design.md`

## Global Constraints

- Canvas 1080×1920, 30 fps, ~8 Mbps; MP4 (`video/mp4;codecs=avc1`) when `MediaRecorder.isTypeSupported` says so, else WebM.
- Scene durations (s): hook 2, results 4, topPredictor 3, boldCall 3, payoff 4, cta 2. Skipped scenes close the gap.
- Thresholds: a game needs **≥ 5 picks** for any percentage; upset needs loser share **> 50%**; bold call needs **≥ 1 correct**. Percentages are `Math.round(share * 100)`.
- Pull window: previous round's last tip-off → this round's last tip-off + 24 h. Rank: foil legendary > legendary > rare; earlier `unlocked_at` wins ties.
- Admins (`users.is_admin`) are excluded from every statistic. Usernames and user ids never appear in the response.
- Copy is fixed by the spec (EN/EL table in Task 3). Team names are nominative and come from the clip team table.
- Brand: background `#0d0d10`, orange `#f0761c`, Sofia Sans (400/600) and Sofia Sans Condensed (800); fonts awaited with `document.fonts.load` incl. a Greek sample before drawing.
- Exported file name: `clutch-<season>-round-<n>-<lang>.<mp4|webm>`.
- UI strings for the page go in `core/i18n/admin.ts` in EN and EL in the same edit.

## Review Focus

1. A club not in the clip team table (promotion, rename) → names fall back to `teams.name`, alias is title-only. Pinned in Task 1.
2. A featured user with no favourite team → title-only alias. Pinned in Task 1.
3. Exactly 50% on the loser, or a game with 4 picks → not an upset / not eligible. Pinned in Task 1.
4. Long Greek strings ("Ο Μοναχικός Λύκος του Βελιγραδίου", "ΕΡΥΘΡΟΣ ΑΣΤΕΡΑΣ") → shrink to fit, never clipped. Pinned in Task 4 (`fitFontSize` test + visual check).
5. Image host down or slow → that image is `null` and the frame draws initials; the endpoint still answers. Pinned in Task 2.

---

### Task 1: Clip team table and selection rules (backend, pure)

**Files:**
- Create: `backend/src/services/roundClip/teams.ts`
- Create: `backend/src/services/roundClip/select.ts`
- Test: `backend/src/services/roundClip/select.test.ts`

**Interfaces:**
- Produces:
  - `type ClipLang = "en" | "el"`; `type Alias = { en: string; el: string }`; `type AliasTitle = "oracle" | "loneWolf" | "goldenHands"`
  - `CLIP_TEAMS: Record<string, { en: string; el: string; cityEn: string; cityEl: string }>` keyed by `teams.code`
  - `clipTeamNames(code: string, fallbackName: string): { en: string; el: string }`
  - `clipAlias(title: AliasTitle, teamCode: string | null): Alias`
  - `interface GamePickStats { gameId: string; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number; tipoffAt: Date; picks: number; pickedHome: number; homeFairProb: number | null }`
  - `pickHook(games: GamePickStats[]): { gameId: string; pickedLoserPct: number | null } | null`
  - `pickBoldCall(games: GamePickStats[], excludeGameId: string | null): { gameId: string; correctPct: number } | null`
  - `interface PullCandidate { userId: string; name: string; imageUrl: string | null; tier: string; finish: string; unlockedAt: Date }`
  - `pickPull(cards: PullCandidate[]): PullCandidate | null`

Team table values (EN short / EL short / city EN / city EL):
ASV ASVEL/Βιλερμπάν/Villeurbanne/της Βιλερμπάν · BAR Barcelona/Μπαρτσελόνα/Barcelona/της Βαρκελώνης · BAS Baskonia/Μπασκόνια/Vitoria/της Βιτόρια · BES Besiktas/Μπεσίκτας/Istanbul/της Πόλης · DUB Dubai/Ντουμπάι/Dubai/του Ντουμπάι · HTA Hapoel Tel Aviv/Χάποελ Τελ Αβίβ/Tel Aviv/του Τελ Αβίβ · IST Anadolu Efes/Εφές/Istanbul/της Πόλης · MAD Real Madrid/Ρεάλ Μαδρίτης/Madrid/της Μαδρίτης · MCO Monaco/Μονακό/Monaco/του Μονακό · MIL Olimpia Milano/Αρμάνι Μιλάνο/Milan/του Μιλάνου · MUN Bayern/Μπάγερν/Munich/του Μονάχου · OLY Olympiacos/Ολυμπιακός/Piraeus/του Πειραιά · PAM Valencia/Βαλένθια/Valencia/της Βαλένθιας · PAN Panathinaikos/Παναθηναϊκός/Athens/της Αθήνας · PAR Partizan/Παρτιζάν/Belgrade/του Βελιγραδίου · PRS Paris/Παρί/Paris/του Παρισιού · RED Crvena Zvezda/Ερυθρός Αστέρας/Belgrade/του Βελιγραδίου · TEL Maccabi Tel Aviv/Μακάμπι Τελ Αβίβ/Tel Aviv/του Τελ Αβίβ · ULK Fenerbahce/Φενέρμπαχτσε/Istanbul/της Πόλης · VIR Virtus Bologna/Βίρτους Μπολόνια/Bologna/της Μπολόνια · ZAL Zalgiris/Ζάλγκιρις/Kaunas/του Κάουνας

Alias titles: oracle "The Oracle" / "Ο Μάντης"; loneWolf "The Lone Wolf" / "Ο Μοναχικός Λύκος"; goldenHands "Golden Hands" / "Χρυσά Χέρια". Alias = `${title} of ${cityEn}` / `${title} ${cityEl}`.

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert/strict`):
  - `clipAlias("oracle", "OLY")` → `{ en: "The Oracle of Piraeus", el: "Ο Μάντης του Πειραιά" }`
  - `clipAlias("goldenHands", null)` → `{ en: "Golden Hands", el: "Χρυσά Χέρια" }`; `clipAlias("loneWolf", "XYZ")` → `{ en: "The Lone Wolf", el: "Ο Μοναχικός Λύκος" }`
  - `clipTeamNames("XYZ", "New Club Riga")` → `{ en: "New Club Riga", el: "New Club Riga" }`; `clipTeamNames("ULK", "…")` → `{ en: "Fenerbahce", el: "Φενέρμπαχτσε" }`
  - `pickHook`: of games with 78% (14/18 picked the loser), 60%, and 90% with only 4 picks → returns the 78% game, `pickedLoserPct: 78`
  - `pickHook`: a game with exactly 50% on the loser and nothing else qualifying, ≥ 5 picks somewhere → `null`
  - `pickHook`: every game < 5 picks → the game whose winner had the lowest pre-game fair prob below 0.5, `pickedLoserPct: null`; no odds → `null`
  - `pickBoldCall`: correct shares 12% (≥ 5 picks), 0% (no correct), 40% → the 12% game, `correctPct: 12`; with that game excluded → the 40% game
  - `pickPull`: [standard legendary early, foil legendary later, rare] → the foil; [rare, standard legendary] → the legendary; [] → `null`
- [ ] **Step 2:** `cd backend && npx tsx --test src/services/roundClip/select.test.ts` → FAIL (modules missing)
- [ ] **Step 3:** Implement `teams.ts` and `select.ts` per the interfaces. Winner = higher score; "picked the loser" share = `(loser is home ? pickedHome : picks - pickedHome) / picks`. Ties between equal shares → later `tipoffAt` wins (the most recent game is the freshest story).
- [ ] **Step 4:** Same command → all PASS
- [ ] **Step 5:** Commit `feat(clips): clip team table and selection rules`

### Task 2: Round clip endpoint

**Files:**
- Create: `backend/src/services/roundClip/data.ts`
- Create: `backend/src/services/roundClip/images.ts`
- Test: `backend/src/services/roundClip/images.test.ts`
- Modify: `backend/src/routes/admin.ts` (two routes at the end)

**Interfaces:**
- Consumes: everything Task 1 produces; `getRoundStandings(season, round)` (`services/roundStandings.ts`, sorted best first, admins excluded); `getCurrentSeason()`.
- Produces (JSON shape; mirrored in Task 3):
  ```ts
  interface ClipTeam { code: string; name: { en: string; el: string }; color: string | null; logo: string | null }
  interface RoundClipData {
    season: string; round: number;
    results: { home: ClipTeam; away: ClipTeam; homeScore: number; awayScore: number }[];   // tip-off order
    hook: { winner: ClipTeam; loser: ClipTeam; score: string; pickedLoserPct: number | null } | null;
    topPredictor: { alias: Alias; correct: number; total: number; points: number } | null;
    boldCall: { winner: ClipTeam; loser: ClipTeam; score: string; correctPct: number; alias: Alias } | null;
    pull: { name: string; photo: string | null; tier: "legendary" | "rare"; foil: boolean; alias: Alias } | null;
    next: { round: number; picksOpen: boolean } | null;
  }
  ```
  `score` is winner-first, en dash: `"90–88"`. `logo`/`photo` are data URIs or `null`.
  - `imageToDataUri(url: string | null, timeoutMs = 4000): Promise<string | null>` — in-memory cache by URL; `null` on non-2xx, timeout, or non-image content type.
  - `buildRoundClip(season: string, round: number): Promise<RoundClipData>`; throws `RoundNotFinalError` when any game in the round isn't final or the round has no games.
  - `listFinishedRounds(season: string): Promise<number[]>` — rounds whose games are all final, newest first.
  - Routes: `GET /api/admin/round-clip/rounds?season=` → `{ season, rounds }` (season defaults to `getCurrentSeason()`); `GET /api/admin/round-clip?season=&round=` → `RoundClipData`, 409 `{ error: "Round <n> still has games to play" }` on `RoundNotFinalError`, 400 on a bad `round`. Both `requireAuth, requireAdmin`.

- [ ] **Step 1: Write the failing test** `images.test.ts`: `imageToDataUri(null)` → `null`; `imageToDataUri("http://127.0.0.1:9/x.png", 500)` → `null` (connection refused, resolves within the timeout); a 1×1 PNG served by a throwaway `http.createServer` → string starting `data:image/png;base64,`.
- [ ] **Step 2:** `npx tsx --test src/services/roundClip/images.test.ts` → FAIL
- [ ] **Step 3:** Implement `images.ts`, then `data.ts`. Keep round trips low (CLAUDE.md: latency is round trips on Neon): one statement for games + per-game pick counts + odds + team rows; one for the round window's pull candidates joined to `users.favorite_team_id` (non-admin); one for the bold call's correct pickers (pick the one ranked highest in `getRoundStandings`); one for `next`. The top predictor's and pullers' favourite team code comes from `users.favorite_team_id → teams.code`. When `hook` is `null` and `boldCall` exists, still return both as computed (the frontend decides placement).
- [ ] **Step 4:** Test PASS; `npx tsc -p tsconfig.json --noEmit` clean.
- [ ] **Step 5: Verify on dev.** Local `.env` points at dev (check the host is `ep-sparkling-pond-…`). Write a throwaway script calling `buildRoundClip("2026-27", 5)` and printing everything except data URIs (print their length). Cross-check the hook game and pct, the bold call, the top predictor's correct/total/points, and the pull against hand-written SQL for that round; record both outputs in the task report. Delete the script.
- [ ] **Step 6:** Commit `feat(clips): admin round-clip endpoint`

### Task 3: Frontend data, timeline and clip text (pure)

**Files:**
- Modify: `frontend/src/app/core/models.ts` (add `ClipTeam`, `RoundClipData`, `Alias` exactly as Task 2)
- Modify: `frontend/src/app/core/api.service.ts` (`getRoundClipRounds(season?: string): Observable<{ season: string; rounds: number[] }>`, `getRoundClip(season: string, round: number): Observable<RoundClipData>`)
- Create: `frontend/src/app/features/admin/clips/clip-timeline.ts`
- Create: `frontend/src/app/features/admin/clips/clip-text.ts`
- Test: `frontend/src/app/features/admin/clips/clip-timeline.test.ts`

**Interfaces:**
- Produces:
  - `type SceneId = "hook" | "results" | "topPredictor" | "boldCall" | "payoff" | "cta"`
  - `interface Scene { id: SceneId; start: number; end: number; variant?: "upset" | "boldCall" }` (seconds)
  - `buildTimeline(data: RoundClipData): Scene[]` — order hook, results, topPredictor, boldCall, payoff, cta. Hook: `variant "upset"` when `data.hook`; else `variant "boldCall"` when `data.boldCall` (and the boldCall scene is then dropped); else no hook scene. topPredictor dropped when `null`. results, payoff, cta always present.
  - `clipDuration(t: Scene[]): number`; `sceneAt(t: Scene[], time: number): { scene: Scene; local: number } | null` (`local` = seconds into the scene; the last scene holds past the end)
  - `easeOutCubic(x: number): number`, `easeOutBack(x: number): number`, `progress(local: number, from: number, dur: number): number` (clamped 0..1)
  - `type ClipLang = "en" | "el"`; `clipText(key: ClipTextKey, lang: ClipLang, vars?: Record<string, string | number>): string` replacing `{name}` placeholders
- Copy (`ClipTextKey` → en / el):
  - `hookSaid` "{pct}% of Clutch players said" / "Το {pct}% των παικτών του Clutch είπε"
  - `hookLost` "THEY LOST {score}" / "ΕΧΑΣΕ {score}"
  - `hookUpsetNoPct` "Nobody saw this coming" / "Κανείς δεν το περίμενε"
  - `teaser` "🔒 legendary pull at the end" / "🔒 legendary κάρτα στο τέλος"
  - `topPredictor` "Top predictor" / "Κορυφαίος προβλέπων"
  - `pts` "+{n} pts this round" / "+{n} πόντοι στην αγωνιστική"
  - `boldOnly` "Only {pct}% said" / "Μόνο το {pct}% είπε"
  - `boldWon` "and they won {score}" / "και κέρδισε {score}"
  - `pulledBy` "Pulled this round by" / "Την τράβηξε στην αγωνιστική"
  - `packsFree` "Open packs free in Clutch" / "Άνοιξε πακέτα δωρεάν στο Clutch"
  - `ctaQuestion` "THINK YOU'D DO BETTER?" / "ΕΣΥ ΘΑ ΤΑ ΠΗΓΑΙΝΕΣ ΚΑΛΥΤΕΡΑ;"
  - `ctaOpen` "{round} picks are open" / "Άνοιξαν οι προβλέψεις · {round}"
  - `ctaPlay` "Play the next round" / "Παίξε στην επόμενη αγωνιστική"
  - `ctaFree` "Free · link in bio" / "Δωρεάν · link στο bio"
  - `legendary` "LEGENDARY" / "LEGENDARY"; `foil` "FOIL LEGENDARY" / "FOIL LEGENDARY"; `rare` "RARE" / "RARE"
  - Round names reuse `shared/round-label.ts`'s numbering; add `roundLabelFor(round: number, lang: ClipLang): string` in `clip-text.ts` using the same EN/EL strings as the `round.*` keys in `core/i18n/chrome.ts` (read them from `chromeTranslations` so wording can't drift).

- [ ] **Step 1: Write the failing tests** for `buildTimeline` with fixtures: (a) all present → 6 scenes, starts 0/2/6/9/12/16, `clipDuration` 18; (b) `hook: null`, boldCall present → first scene `hook` with `variant "boldCall"`, no `boldCall` scene, duration 15; (c) hook, boldCall and topPredictor all `null` → `results, payoff, cta`, duration 10; `sceneAt(t, 17.9)` → cta, `sceneAt(t, 30)` → cta (hold); `clipText("hookSaid", "el", { pct: 78 })` → "Το 78% των παικτών του Clutch είπε"; `roundLabelFor(41, "en")` → "Playoffs · Game 1".
- [ ] **Step 2:** `cd frontend && npx tsx --test src/app/features/admin/clips/clip-timeline.test.ts` → FAIL
- [ ] **Step 3:** Implement. Keep `clip-timeline.ts` and `clip-text.ts` free of Angular imports so tsx can run them (`chrome.ts` only imports a type).
- [ ] **Step 4:** Tests PASS; `npx ng build` succeeds (test files aren't in the app's tsconfig `files`, confirm they aren't picked up).
- [ ] **Step 5:** Commit `feat(clips): clip timeline, copy and API client`

### Task 4: Renderer and the `/admin/clips` page with live preview

**Files:**
- Create: `frontend/src/app/features/admin/clips/clip-fit.ts` (Angular-free)
- Create: `frontend/src/app/features/admin/clips/clip-renderer.ts`
- Create: `frontend/src/app/features/admin/clips/round-clip-page.ts` (inline template, like `admin-push.ts`)
- Test: `frontend/src/app/features/admin/clips/clip-fit.test.ts`
- Modify: `frontend/src/app/app.routes.ts` (route `admin/clips`, lazy, next to `admin/tools`, same gating comment)
- Modify: `frontend/src/app/features/admin/admin-tools.html` (an `<a routerLink="/admin/clips">` card after the tools grid, same classes as a tool box) and `admin-tools.ts` imports (`RouterLink`)
- Modify: `frontend/src/app/core/i18n/admin.ts` (EN+EL: `admin.clips.title` "Round clips"/"Κλιπ αγωνιστικής", `admin.clips.desc` "Export a TikTok/Reels clip of a finished round"/"Εξαγωγή κλιπ για TikTok/Reels από ολοκληρωμένη αγωνιστική", `admin.clips.round`, `admin.clips.lang`, `admin.clips.export` "Export MP4"/"Εξαγωγή MP4", `admin.clips.recording` "Recording… keep this tab open"/"Εγγραφή… κράτα την καρτέλα ανοιχτή", `admin.clips.noHook` "No upset or bold call this round — the clip opens on the results."/"Χωρίς έκπληξη ή τολμηρή πρόβλεψη — το κλιπ ξεκινά με τα αποτελέσματα.", `admin.clips.unsupported` "Use desktop Chrome or Safari to export."/"Χρησιμοποίησε Chrome ή Safari σε υπολογιστή για εξαγωγή.", `admin.clips.webmNote` "This browser saves WebM; TikTok prefers MP4 (Chrome/Safari)."/"Αυτός ο browser αποθηκεύει WebM· το TikTok προτιμά MP4 (Chrome/Safari).", `admin.clips.hidden` "Recording stopped because the tab was hidden. Export again with this tab in front."/"Η εγγραφή σταμάτησε επειδή η καρτέλα κρύφτηκε. Κάνε ξανά εξαγωγή με την καρτέλα μπροστά.")

**Interfaces:**
- Consumes: Task 3's timeline, text, models and API methods.
- Produces:
  - `type ClipImages = Map<string, HTMLImageElement>` keyed by the data URI
  - `loadClipImages(data: RoundClipData): Promise<ClipImages>` (skips nulls; a failed decode is just absent)
  - `ensureClipFonts(): Promise<void>` — `document.fonts.load` for `400 40px "Sofia Sans"`, `600 40px "Sofia Sans"`, `800 80px "Sofia Sans Condensed"`, each with sample text `"Aα"`
  - `fitFontSize(measure: (px: number) => number, maxWidth: number, startPx: number, minPx: number): number` in `clip-fit.ts` — largest px ≤ `startPx` whose measured width ≤ `maxWidth`, never below `minPx`
  - `drawClipFrame(ctx: CanvasRenderingContext2D, data: RoundClipData, timeline: Scene[], images: ClipImages, time: number, lang: ClipLang): void` — always draws the full 1080×1920 frame
  - `RoundClipPageComponent` (selector `app-round-clip-page`)

Scene drawing (positions in canvas px; all text through `fitFontSize` with 960 px max width unless noted):
- Background every frame: `#0d0d10` plus a radial glow (`#f0761c` at 0.25 alpha, or the hook loser's `color` during the hook).
- Corner card (all scenes before payoff): 180×252 rounded card, orange border, "?" in Condensed 800, wobble `rotate(sin(time*9)*0.05)`; centred at (540, 420) during the hook, (930, 1700) afterwards.
- hook/upset: `hookSaid` 44 px at y 860 fading in 0–0.3 s; loser short name Condensed 150 px orange at y 1040 (0.15–0.45 s); `hookLost` 110 px red `#ff4d4d` at y 1230 slamming from scale 2.2 to 1 with `easeOutBack` at 0.9–1.2 s; `teaser` 34 px at y 1820. With `pickedLoserPct: null` the first line is `hookUpsetNoPct`. hook/boldCall uses the boldCall texts in the same three slots (`boldOnly`, winner name in green `#3ddc84`, `boldWon`).
- results: round label 70 px at y 260; up to 10 rows from y 420, 120 px apart, each row (logo 72 px, code, score, code, logo) sliding in from the right with `easeOutCubic`, staggered 0.25 s.
- topPredictor: `topPredictor` 44 px y 700, alias Condensed 96 px orange y 820, `correct/total` Condensed 260 px y 1100, `pts` 44 px y 1260; scale-in 0.9→1.
- boldCall: same three slots as hook/boldCall plus the alias 64 px at y 1400.
- payoff: card flip over 0–0.6 s (`scaleX` 1→0, swap face, 0→1), light burst (expanding ring, alpha out) at 0.6 s; face 600×840 at (540, 860): photo cover-fitted, gold gradient for legendary (`#ffd36b → #f0761c → #7a2a00`), add a moving sheen for foil, silver for rare; tier label and name on the card; `pulledBy` + alias below at y 1420/1500. `pull: null` → card face shows the Clutch logo text and `packsFree`.
- cta: `ctaQuestion` Condensed 120 px y 760; pill with `ctaOpen` (`{round}` = `roundLabelFor(next.round)`) when `next?.picksOpen`, else `ctaPlay`, y 1000; `getclutchapp.com` Condensed 90 px orange y 1180; `ctaFree` 40 px y 1280. No animation in the last 1.5 s (cover frame).
- Missing logo/photo → a circle in the team colour (or grey) with the code / initials.

Page: `app-dropdown` for the round (from `getRoundClipRounds`), two buttons for EN/EL, a `<canvas width=1080 height=1920>` shown at `max-height: 70vh`, `aspect-ratio: 9/16`, driven by `requestAnimationFrame` looping `clipDuration`, the `noHook` warning when the timeline has no hook scene, and the Export button (wired in Task 5; disabled for now). Back-link `navHistory.previousUrl() ?? '/admin/tools'`. Fonts + images awaited before the first frame; show a skeleton until then.

- [ ] **Step 1: Write the failing test** `clip-fit.test.ts`: with `measure = px => px * 10`, `fitFontSize(measure, 960, 150, 40)` → 96; `fitFontSize(measure, 300, 150, 40)` → 40 (floor); `fitFontSize(measure, 2000, 150, 40)` → 150.
- [ ] **Step 2:** `npx tsx --test src/app/features/admin/clips/clip-fit.test.ts` → FAIL
- [ ] **Step 3:** Implement `clip-fit.ts`, then the renderer, page, route, tools card, i18n.
- [ ] **Step 4:** Test PASS; `npx ng build` succeeds.
- [ ] **Step 5: Visual check.** Run backend (`npm run dev`, dev DB) and `npm start`; as an admin open `/admin/clips`, pick round 5, watch the preview in EN and EL. Confirm: no text runs off the canvas in EL (check a round involving RED or ULK), the corner card wobbles until the flip, the last frame is still. Ask the user for a screenshot of the EL preview (CLAUDE.md: don't drive Chrome for UI checks).
- [ ] **Step 6:** Commit `feat(clips): clip renderer and /admin/clips preview page`

### Task 5: Recording and export

**Files:**
- Create: `frontend/src/app/features/admin/clips/clip-recorder.ts` (no Angular imports; DOM APIs only inside `recordClip`)
- Modify: `frontend/src/app/features/admin/clips/round-clip-page.ts`
- Test: `frontend/src/app/features/admin/clips/clip-recorder.test.ts`

**Interfaces:**
- Consumes: `drawClipFrame`, `clipDuration`, the page's canvas.
- Produces:
  - `pickRecorderFormat(isSupported: (mime: string) => boolean): { mime: string; ext: "mp4" | "webm" } | null` — tries `video/mp4;codecs=avc1`, `video/mp4`, `video/webm;codecs=vp9`, `video/webm` in that order
  - `class ClipHiddenError extends Error`
  - `recordClip(canvas: HTMLCanvasElement, durationSec: number, renderAt: (time: number) => void, onProgress: (fraction: number) => void): Promise<{ blob: Blob; ext: "mp4" | "webm" }>` — `canvas.captureStream(30)`, `videoBitsPerSecond: 8_000_000`, renders by `requestAnimationFrame` from `performance.now()`, stops after `durationSec + 0.2`; rejects with `ClipHiddenError` on `visibilitychange` to hidden.

- [ ] **Step 1: Write the failing test** `clip-recorder.test.ts`: `pickRecorderFormat(m => m.startsWith("video/webm"))` → `{ mime: "video/webm;codecs=vp9", ext: "webm" }`; `pickRecorderFormat(() => true)` → mp4 avc1; `pickRecorderFormat(() => false)` → `null`.
- [ ] **Step 2:** `npx tsx --test src/app/features/admin/clips/clip-recorder.test.ts` → FAIL. **Step 3:** Implement the recorder; on the page: Export disabled with `admin.clips.unsupported` when `pickRecorderFormat(MediaRecorder.isTypeSupported)` is `null` or `MediaRecorder` is undefined; while recording, pause the preview loop, show a progress bar and `admin.clips.recording`; on success download via an object URL + `<a download>` named per Global Constraints and revoke the URL; show `admin.clips.webmNote` for WebM; on `ClipHiddenError` show `admin.clips.hidden`.
- [ ] **Step 4:** Test PASS; `npx ng build` succeeds.
- [ ] **Step 5: End-to-end check (with the user).** Export round 5 in EN and EL from desktop Chrome; confirm each file is ~18 s, 1080×1920, plays in the OS player, and the user uploads one as a private TikTok draft. Hide the tab mid-export once to see the `hidden` message.
- [ ] **Step 6:** Commit `feat(clips): record and export round clips`
