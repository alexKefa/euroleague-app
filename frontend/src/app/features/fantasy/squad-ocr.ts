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
 * How well `surname` appears in an OCR line: 2 = exact whole-word match,
 * 1 = a near miss (a few OCR slips scaled to the surname's length, a long
 * name truncated with an ellipsis by the EL Fantasy UI, or one word the
 * OCR split in two), 0 = not there.
 */
function matchScore(lineTokens: string[], lineText: string, surname: string): number {
  if (surname.length < 3) return 0;
  if (surname.includes(" ")) return ` ${lineText} `.includes(` ${surname} `) ? 2 : 0;
  if (lineTokens.includes(surname)) return 2;
  const maxEdits = maxEditsFor(surname);
  // Adjacent token pairs cover a long surname the OCR broke in two.
  const joined = lineTokens.slice(0, -1).map((t, i) => t + lineTokens[i + 1]);
  for (const t of [...lineTokens, ...joined]) {
    if (maxEdits > 0 && t.length >= 5 && levenshtein(t, surname, maxEdits) <= maxEdits) return 1;
    if (t.length >= MIN_TRUNCATED_PREFIX && t.length < surname.length && surname.startsWith(t)) return 1;
  }
  return 0;
}

// Squad screens put names over the court, jerseys and coloured panels —
// Tesseract treats a mid-tone background region as picture, not text, and
// skips it entirely (verified: names drawn on a court-coloured area were
// never read until binarized). So every screenshot is read twice, each
// pass thresholded to pure black-on-white: once keeping only *bright*
// pixels as text (white names on dark/coloured UI), once keeping only
// *dark* pixels (dark names on light panels). The two passes' lines merge.
const BRIGHT_TEXT_MIN = 170;
const DARK_TEXT_MAX = 90;

// Decodes the picked file without a blob: URL — production's CSP allows
// img-src 'self' data: https: only, so `<img src=blob:...>` is refused
// there (verified: "unreadable image" on the live site, while localhost,
// which has no CSP, worked). createImageBitmap reads the File directly and
// isn't subject to img-src; a data: URL is the fallback for a browser/
// format it rejects.
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

async function prepareImages(file: File): Promise<[HTMLCanvasElement, HTMLCanvasElement]> {
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

  const make = (isText: (luma: number) => boolean) => {
    const out = new ImageData(width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const luma = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
      const v = isText(luma) ? 0 : 255;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.putImageData(out, 0, 0);
    return canvas;
  };
  return [make((l) => l >= BRIGHT_TEXT_MIN), make((l) => l <= DARK_TEXT_MAX)];
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
    teamTokens: new Set([normalize(r.team.code), ...normalize(r.team.name).split(" ")]),
  }));
  const coachCandidates = coaches
    .filter((c) => c.headCoach)
    .map((c) => ({ teamId: c.team.id, surname: surnameOf(c.headCoach!), initial: firstInitialOf(c.headCoach!) }));

  // First sighting position per player — both OCR passes see the same
  // layout, so the earliest (top-most, then left-most) sighting wins.
  const seenAt = new Map<string, { y: number; x: number; cx: number; cy: number; h: number }>();
  const ambiguous = new Set<string>();
  let coachTeamId: string | null = null;

  for (const line of lines) {
    const text = normalize(line.text);
    if (!text) continue;
    const tokens = text.split(" ");

    let best = 0;
    let hits: typeof candidates = [];
    for (const c of candidates) {
      const score = matchScore(tokens, text, c.surname);
      if (score === 0 || score < best) continue;
      if (score > best) {
        best = score;
        hits = [];
      }
      hits.push(c);
    }
    // Several players share a surname — narrow by a first initial ("M. JAMES")
    // or a club name/code on the same line before giving up.
    if (hits.length > 1) {
      const byInitial = hits.filter((c) => c.initial && tokens.includes(c.initial));
      if (byInitial.length >= 1) hits = byInitial;
    }
    if (hits.length > 1) {
      const byTeam = hits.filter((c) => tokens.some((t) => t.length >= 3 && c.teamTokens.has(t)));
      if (byTeam.length >= 1) hits = byTeam;
    }
    if (hits.length === 1) {
      const prev = seenAt.get(hits[0].id);
      if (!prev || line.y < prev.y) {
        seenAt.set(hits[0].id, { y: line.y, x: line.x, cx: line.cx ?? line.x, cy: line.cy ?? line.y, h: line.h ?? 0 });
      }
    } else if (hits.length > 1) {
      ambiguous.add(hits[0].surname);
    }

    if (!coachTeamId) {
      const coachHits = coachCandidates.filter((c) => matchScore(tokens, text, c.surname) === 2);
      if (coachHits.length === 1) coachTeamId = coachHits[0].teamId;
    }
  }

  // Drop an ambiguity note once that surname did get resolved on another line.
  for (const id of seenAt.keys()) {
    const s = candidates.find((c) => c.id === id)?.surname;
    if (s) ambiguous.delete(s);
  }

  // Reading order with a row tolerance, so names on the same visual row
  // (a court's front line) sort left-to-right rather than by pixel jitter.
  const ROW_TOLERANCE = 40;
  const playerIds = [...seenAt.entries()]
    .sort(([, a], [, b]) => (Math.abs(a.y - b.y) <= ROW_TOLERANCE ? a.x - b.x : a.y - b.y))
    .map(([id]) => id);

  return { playerIds, coachTeamId, ambiguous: [...ambiguous], captainId: findCaptain(lines, seenAt) };
}

// A standalone "C" is the captain badge. The badge's circle outline tends
// to come back as a stray bracket/bar either side of the letter (verified:
// a dark C in a yellow circle read as "Lc]"), so allow one such character
// on each side; "©" is the whole badge read as a single glyph.
const CAPTAIN_BADGE = /^[([{|lLI1]?[C©][)\]}|lI1]?$/i;
const POSITION_LETTER = /^[GF]$/i;
// How far (in multiples of the name label's own height) a badge may sit
// from a name and still count as that player's — the badge is drawn on the
// jersey/card corner, a few text-heights away from the name label.
const CAPTAIN_MAX_DISTANCE = 6;

/**
 * Best-effort captain detection: the matched player nearest a lone "C"
 * badge. Deliberately conservative — returns null (user picks, as before)
 * when no badge is read, when badges point at more than one player, or
 * when lone "G"/"F" words also appear, since that means single letters on
 * this screen are position labels and a lone "C" is just as likely "Center".
 */
function findCaptain(lines: OcrLine[], seenAt: Map<string, { cx: number; cy: number; h: number }>): string | null {
  const words = lines.flatMap((l) => l.words ?? []);
  if (words.some((w) => POSITION_LETTER.test(w.text.trim()))) return null;
  const badges = words.filter((w) => CAPTAIN_BADGE.test(w.text.trim()));
  const captains = new Set<string>();
  for (const badge of badges) {
    let best: { id: string; dist: number } | null = null;
    for (const [id, at] of seenAt) {
      if (!at.h) continue;
      const dist = Math.hypot(badge.cx - at.cx, badge.cy - at.cy);
      if (dist <= at.h * CAPTAIN_MAX_DISTANCE && (!best || dist < best.dist)) best = { id, dist };
    }
    if (best) captains.add(best.id);
  }
  return captains.size === 1 ? [...captains][0] : null;
}
