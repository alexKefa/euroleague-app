import { FantasyCoachRow, FantasyPlayerRow } from "../../core/models";

/**
 * "Import from EuroLeague Fantasy" (2026-09-28) — reads a screenshot of the
 * user's real EL Fantasy squad entirely in their own browser with
 * Tesseract.js (free, no API, nothing uploaded), then matches the surnames
 * it finds against our own player pool. The real EL Fantasy site is a
 * Flutter canvas app with no readable DOM/REST squad call (see CLAUDE.md's
 * 2026-09-24 investigation), so pixels are the only way in.
 *
 * OCR only gives us names and where they sit on the screen — not roles or
 * the captain badge reliably — so this returns matched players in reading
 * order and leaves slot/captain decisions to the caller (fantasy.ts).
 *
 * Every Tesseract asset (worker, wasm core, English LSTM data) is
 * self-hosted under /tesseract/ via angular.json's assets config — the
 * library's default jsDelivr URLs would be blocked by the backend's CSP.
 */

const ASSET_BASE = "/tesseract";

export interface OcrSquadResult {
  /** Matched player ids, top-to-bottom / left-to-right as seen in the screenshot. */
  playerIds: string[];
  coachTeamId: string | null;
  /** Surnames that matched more than one player we couldn't tell apart. */
  ambiguous: string[];
  /** Player nearest the lone "C" captain badge, when exactly one such player is found. */
  captainId: string | null;
}

export interface OcrWord {
  text: string;
  cx: number;
  cy: number;
}

export interface OcrLine {
  text: string;
  y: number;
  x: number;
  /** Line height and centre — used to measure distance to a captain badge. */
  h?: number;
  cx?: number;
  cy?: number;
  words?: OcrWord[];
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
}

/** Feed names are "SURNAME, First"; coach names may be either shape. */
function surnameOf(name: string): string {
  const comma = name.indexOf(",");
  if (comma !== -1) return normalize(name.slice(0, comma));
  const parts = normalize(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

function firstInitialOf(name: string): string | null {
  const comma = name.indexOf(",");
  const first = comma !== -1 ? normalize(name.slice(comma + 1)) : normalize(name).split(" ")[0];
  return first ? first[0] : null;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** OCR slips tolerated for a surname of this length — longer names have more room for misread letters while staying unambiguous. */
function maxEditsFor(surname: string): number {
  if (surname.length >= 10) return 2;
  if (surname.length >= 6) return 1;
  return 0;
}

// Shortest cut-off prefix accepted as a truncated surname ("ROGKAVOPOU…").
const MIN_TRUNCATED_PREFIX = 6;

/**
 * Where and how well `surname` appears among a line's tokens: score 2 =
 * exact, 1 = a near miss (a few OCR slips scaled to the surname's length,
 * a long name truncated with an ellipsis by the EL Fantasy UI, or one word
 * the OCR split in two); `at` is the index of the (first) matched token.
 * Returns null when it isn't there.
 */
function matchAt(tokens: string[], surname: string): { score: number; at: number; len: number } | null {
  // Two-letter surnames ("LO") only count exactly and right after a single
  // letter — a position prefix or initial ("G Lo", "M. Lo") — since a bare
  // two-letter token is far too common in OCR noise.
  if (surname.length === 2) {
    const at = tokens.findIndex((t, i) => t === surname && i > 0 && tokens[i - 1].length === 1);
    return at === -1 ? null : { score: 2, at, len: 1 };
  }
  if (surname.length < 2) return null;
  if (surname.includes(" ")) {
    const words = surname.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((w, k) => tokens[i + k] === w)) return { score: 2, at: i, len: words.length };
    }
    return null;
  }
  const exact = tokens.indexOf(surname);
  if (exact !== -1) return { score: 2, at: exact, len: 1 };
  const maxEdits = maxEditsFor(surname);
  // Adjacent token pairs cover a long surname the OCR broke in two.
  for (let i = 0; i < tokens.length; i++) {
    const options = i + 1 < tokens.length ? [{ t: tokens[i], len: 1 }, { t: tokens[i] + tokens[i + 1], len: 2 }] : [{ t: tokens[i], len: 1 }];
    for (const { t, len } of options) {
      if (maxEdits > 0 && t.length >= 5 && levenshtein(t, surname, maxEdits) <= maxEdits) return { score: 1, at: i, len };
      if (t.length >= MIN_TRUNCATED_PREFIX && t.length < surname.length && surname.startsWith(t)) return { score: 1, at: i, len };
    }
  }
  return null;
}

// Squad screens put names over the court, jerseys and coloured panels —
// Tesseract treats a mid-tone background region as picture, not text, and
// skips it entirely (verified: names drawn on a court-coloured area were
// never read until binarized). So each screenshot is binarized to pure
// black-on-white four ways and every pass's lines are merged:
// - global cutoffs: bright pixels as text (white names on dark UI), then
//   dark pixels as text (dark names on light panels) — these are what pick
//   up the small captain badge;
// - adaptive (local) cutoffs: a pixel is text when it's clearly brighter /
//   darker than its own surroundings. Needed because EL Fantasy's name
//   labels aren't pure white and sit over a court gradient — verified on a
//   real squad screenshot: Maledon's label was missed by both global passes
//   but read by the adaptive one.
const BRIGHT_TEXT_MIN = 170;
const DARK_TEXT_MAX = 90;
const ADAPTIVE_CONTRAST = 15;
// Local window radius as a fraction of the long edge — about one line of
// label text at the 1500-2500px working size.
const ADAPTIVE_RADIUS_DIVISOR = 170;

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("unreadable image"));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable image"));
      el.src = dataUrl;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  }
}

async function prepareImages(file: File): Promise<HTMLCanvasElement[]> {
  const img = await decodeImage(file);
  // Tesseract reads small UI text best around 1500-2500px on the long edge.
  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge < 1500 ? 1500 / longEdge : Math.min(1, 2500 / longEdge);
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sctx = source.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(img.source, 0, 0, width, height);
  if (img.source instanceof ImageBitmap) img.source.close();
  const pixels = sctx.getImageData(0, 0, width, height);

  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; p < luma.length; i += 4, p++) {
    luma[p] = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
  }
  const localMean = boxMean(luma, width, height, Math.max(8, Math.round(Math.max(width, height) / ADAPTIVE_RADIUS_DIVISOR)));

  const make = (isText: (p: number) => boolean) => {
    const out = new ImageData(width, height);
    for (let p = 0; p < luma.length; p++) {
      const v = isText(p) ? 0 : 255;
      const i = p * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.putImageData(out, 0, 0);
    return canvas;
  };
  return [
    make((p) => luma[p] >= BRIGHT_TEXT_MIN),
    make((p) => luma[p] <= DARK_TEXT_MAX),
    make((p) => luma[p] > localMean[p] + ADAPTIVE_CONTRAST),
    make((p) => luma[p] < localMean[p] - ADAPTIVE_CONTRAST),
  ];
}

/** Mean of each pixel's (2r+1)² neighbourhood, via a summed-area table (clamped at the edges). */
function boxMean(values: Float32Array, width: number, height: number, r: number): Float32Array {
  // Sums reach width*height*255 (~750M at 2500px) — within Uint32, unlike Float32's exact range.
  const sat = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += Math.round(values[y * width + x]);
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + rowSum;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

async function ocrLines(file: File, onProgress: (pct: number) => void): Promise<OcrLine[]> {
  const mod = await import("tesseract.js");
  const Tesseract = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const images = await prepareImages(file);
  let pass = 0;
  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${ASSET_BASE}/worker.min.js`,
    corePath: `${ASSET_BASE}/core`,
    langPath: `${ASSET_BASE}/lang`,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text") onProgress(Math.round(((pass + m.progress) / images.length) * 100));
    },
  });
  try {
    // Sparse-text mode: a squad screen is scattered labels, not paragraphs.
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const lines: OcrLine[] = [];
    for (const image of images) {
      const { data } = await worker.recognize(image, {}, { blocks: true });
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const b = line.bbox;
            lines.push({
              text: line.text,
              y: b.y0,
              x: b.x0,
              h: b.y1 - b.y0,
              cx: (b.x0 + b.x1) / 2,
              cy: (b.y0 + b.y1) / 2,
              words: line.words.map((w) => ({ text: w.text, cx: (w.bbox.x0 + w.bbox.x1) / 2, cy: (w.bbox.y0 + w.bbox.y1) / 2 })),
            });
          }
        }
      }
      pass++;
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}

export async function readSquadFromScreenshot(
  file: File,
  pool: FantasyPlayerRow[],
  coaches: FantasyCoachRow[],
  onProgress: (pct: number) => void = () => {}
): Promise<OcrSquadResult> {
  const lines = await ocrLines(file, onProgress);
  // Kept on purpose: when a player isn't found, the raw OCR text is the
  // first thing needed to tell a misread from a matching gap.
  console.debug("[fantasy import] OCR lines:", lines.map((l) => l.text.trim()).filter(Boolean));
  return matchSquadLines(lines, pool, coaches);
}

/** Pure name matching over OCR'd lines — split out from the OCR itself so it can be exercised without a browser. */
export function matchSquadLines(
  lines: OcrLine[],
  pool: Pick<FantasyPlayerRow, "player" | "team">[],
  coaches: Pick<FantasyCoachRow, "team" | "headCoach">[]
): OcrSquadResult {
  const candidates = pool.map((r) => ({
    id: r.player.id,
    surname: surnameOf(r.player.name),
    initial: firstInitialOf(r.player.name),
    firstName: firstNameOf(r.player.name),
    positionLetter: r.player.position ? r.player.position[0].toUpperCase() : null,
    teamTokens: new Set([normalize(r.team.code), ...normalize(r.team.name).split(" ")]),
  }));
  const coachCandidates = coaches
    .filter((c) => c.headCoach)
    .map((c) => ({ teamId: c.team.id, surname: surnameOf(c.headCoach!) }));

  // First sighting position per player — both OCR passes see the same
  // layout, so the earliest (top-most, then left-most) sighting wins.
  const seenAt = new Map<string, Sighting>();
  const ambiguous = new Set<string>();
  const badges: OcrWord[] = [];
  let coachTeamId: string | null = null;

  for (const line of lines) {
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const texts = tokens.map((t) => t.text);

    // One line can hold several different players — EL Fantasy puts two
    // labels on the same row ("G Spagnolo  G Maledon") and sparse-mode OCR
    // often reads that as one line. Group candidates by *where* in the line
    // they matched, so only players competing for the same word are
    // treated as a tie (the old one-player-per-line logic dropped both).
    const byPosition = new Map<number, { c: (typeof candidates)[number]; score: number; len: number }[]>();
    for (const c of candidates) {
      const m = matchAt(texts, c.surname);
      if (!m) continue;
      const group = byPosition.get(m.at) ?? [];
      group.push({ c, score: m.score, len: m.len });
      byPosition.set(m.at, group);
    }

    // Exact matches first, then longer ones, so a confirmed surname claims
    // the words it covers ("ALVES DE SOUZA" must not also yield "Souza")
    // and the first name/initial/position letter in front of it ("JOSEP
    // Puerto" must not also yield "Joseph") before anything else can match.
    const claimed = new Set<number>();
    const rank = (g: { score: number; len: number }[]) => Math.max(...g.map((x) => x.score * 10 + x.len));
    const groups = [...byPosition.entries()].sort(([, a], [, b]) => rank(b) - rank(a));
    for (const [at, group] of groups) {
      if (claimed.has(at)) continue;
      const best = rank(group);
      const bestLen = group.find((g) => g.score * 10 + g.len === best)!.len;
      let hits = group.filter((g) => g.score * 10 + g.len === best).map((g) => g.c);
      // Several players share a surname — narrow by what precedes it: EL
      // Fantasy's position letter ("G Thompson"), a first initial or full
      // first name ("D. Thompson", "Darius Thompson"), then a club
      // name/code anywhere on the line, before giving up.
      const before = texts.slice(Math.max(0, at - 2), at);
      for (const narrow of [
        (c: (typeof hits)[number]) => c.positionLetter !== null && before.includes(c.positionLetter),
        (c: (typeof hits)[number]) => (c.initial !== null && before.includes(c.initial)) || (c.firstName !== null && before.includes(c.firstName)),
        (c: (typeof hits)[number]) => texts.some((t) => t.length >= 3 && c.teamTokens.has(t)),
      ]) {
        if (hits.length <= 1) break;
        const narrowed = hits.filter(narrow);
        if (narrowed.length >= 1) hits = narrowed;
      }
      if (hits.length === 1) {
        const hit = hits[0];
        for (let i = at + 1; i < at + bestLen; i++) claimed.add(i);
        for (const i of [at - 1, at - 2]) {
          const t = texts[i];
          if (t && (t === hit.firstName || t === hit.initial || t === hit.positionLetter)) claimed.add(i);
        }
        const tok = tokens[at];
        const prev = seenAt.get(hits[0].id);
        if (!prev || tok.cy < prev.cy) seenAt.set(hits[0].id, { cx: tok.cx, cy: tok.cy, h: line.h ?? 0 });
      } else {
        ambiguous.add(hits[0].surname);
      }
    }

    if (!coachTeamId) {
      const coachHits = coachCandidates.filter((c) => matchAt(texts, c.surname)?.score === 2);
      if (coachHits.length === 1) coachTeamId = coachHits[0].teamId;
    }

    // Captain badge candidates: a lone "C" that isn't a position prefix,
    // i.e. not directly followed on the same line by a name-like word
    // ("C Wright" is Wright's position — Center — not a captaincy).
    for (const w of line.words ?? []) {
      if (!CAPTAIN_BADGE.test(w.text.trim())) continue;
      const idx = (line.words ?? []).indexOf(w);
      const next = (line.words ?? [])[idx + 1];
      if (next && normalize(next.text).replace(/ /g, "").length >= 3) continue;
      badges.push(w);
    }
  }

  // Drop an ambiguity note once that surname did get resolved on another line.
  for (const id of seenAt.keys()) {
    const s = candidates.find((c) => c.id === id)?.surname;
    if (s) ambiguous.delete(s);
  }

  // Reading order with a row tolerance, so names on the same visual row
  // (a court's front line) sort left-to-right rather than by pixel jitter.
  const rowTolerance = Math.max(20, ...[...seenAt.values()].map((s) => s.h * 1.5));
  const playerIds = [...seenAt.entries()]
    .sort(([, a], [, b]) => (Math.abs(a.cy - b.cy) <= rowTolerance ? a.cx - b.cx : a.cy - b.cy))
    .map(([id]) => id);

  return { playerIds, coachTeamId, ambiguous: [...ambiguous], captainId: findCaptain(badges, seenAt) };
}

interface Sighting {
  cx: number;
  cy: number;
  h: number;
}

interface Token {
  text: string;
  cx: number;
  cy: number;
}

/**
 * Normalized tokens with a screen position each — taken per OCR word when
 * word boxes exist (so two players on one line get their own positions),
 * else split from the line text at the line's own position.
 */
function tokenize(line: OcrLine): Token[] {
  const lineCx = line.cx ?? line.x;
  const lineCy = line.cy ?? line.y;
  const source = line.words?.length ? line.words : [{ text: line.text, cx: lineCx, cy: lineCy }];
  const out: Token[] = [];
  for (const w of source) {
    for (const t of normalize(w.text).split(" ")) {
      if (t) out.push({ text: t, cx: w.cx, cy: w.cy });
    }
  }
  return out;
}

function firstNameOf(name: string): string | null {
  const comma = name.indexOf(",");
  if (comma === -1) return null;
  const first = normalize(name.slice(comma + 1)).split(" ")[0];
  return first && first.length >= 2 ? first : null;
}

// A standalone "C" is the captain badge. The badge's circle outline tends
// to come back as a stray bracket/bar either side of the letter (verified:
// a dark C in a yellow circle read as "Lc]"), so allow one such character
// on each side; "©" is the whole badge read as a single glyph.
const CAPTAIN_BADGE = /^[([{|lLI1]?[C©][)\]}|lI1]?$/i;
// How far (in multiples of the name label's own height) a badge may sit
// from a name and still count as that player's — the badge is drawn on the
// jersey/card corner, a few text-heights away from the name label.
const CAPTAIN_MAX_DISTANCE = 6;

/**
 * Best-effort captain detection: the matched player nearest a lone "C"
 * badge (position-letter prefixes are already excluded by the caller).
 * Conservative — null (user picks) when no badge was read or badges point
 * at more than one player.
 */
function findCaptain(badges: OcrWord[], seenAt: Map<string, Sighting>): string | null {
  const captains = new Set<string>();
  for (const badge of badges) {
    let best: { id: string; dist: number } | null = null;
    for (const [id, at] of seenAt) {
      if (!at.h) continue;
      // EL Fantasy draws the badge on the jersey, which sits above the name
      // label — a "C" level with or below a label is noise (a stray glyph
      // near a price box was read as a badge on a real screenshot).
      if (badge.cy >= at.cy - at.h / 2) continue;
      const dist = Math.hypot(badge.cx - at.cx, badge.cy - at.cy);
      if (dist <= at.h * CAPTAIN_MAX_DISTANCE && (!best || dist < best.dist)) best = { id, dist };
    }
    if (best) captains.add(best.id);
  }
  return captains.size === 1 ? [...captains][0] : null;
}
