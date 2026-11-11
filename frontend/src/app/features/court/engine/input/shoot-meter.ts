// Hold-and-release shoot meter (CLUTCH_COURT_SPEC.md §5.2). Owns the meter
// DOM directly (it changes every frame, so it never goes through Angular).
import { METER_FILL_SECONDS, METER_SWEET_CENTER, METER_WHITE_WIDTH } from "../../../../../../../shared/court/constants";
import { ReleaseGrade, meterOverheld, meterValue, timingErrorFromMeter } from "../../../../../../../shared/court/shot";

export class ShootMeter {
  private startedAt: number | null = null;
  /** Seconds to fill this charge (layups fill faster). */
  private fillSeconds = METER_FILL_SECONDS;
  /** Green half-width for this shot (meter units). */
  private green = 0.035;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly fill: HTMLElement
  ) {
    this.setGreen(this.green);
  }

  /** Size the green (and the white band around it) for this shot. */
  private setGreen(half: number): void {
    this.green = half;
    const pct = (v: number) => `${v * 100}%`;
    this.el.style.setProperty("--sweet-bottom", pct(METER_SWEET_CENTER - half));
    this.el.style.setProperty("--sweet-height", pct(half * 2));
    this.el.style.setProperty("--white-bottom", pct(METER_SWEET_CENTER - half - METER_WHITE_WIDTH));
    this.el.style.setProperty("--white-height", pct((half + METER_WHITE_WIDTH) * 2));
    // No green out of range: the shot is a heave.
    this.el.classList.toggle("court-meter-heave", half === 0);
  }

  get charging(): boolean {
    return this.startedAt !== null;
  }

  /** Seconds the button has been held (0 when not charging). */
  heldSeconds(now: number): number {
    return this.startedAt === null ? 0 : (now - this.startedAt) / 1000;
  }

  start(now: number, fillSeconds = METER_FILL_SECONDS, greenHalfWidth = this.green): void {
    this.startedAt = now;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.el.removeAttribute("data-result");
    this.setGreen(greenHalfWidth);
    this.fillSeconds = fillSeconds;
    this.el.classList.toggle("court-meter-layup", fillSeconds !== METER_FILL_SECONDS);
    this.el.style.display = "block";
    this.render(0);
  }

  /** Per frame. Returns true when the hold went past the top and must auto-release. */
  update(now: number): boolean {
    if (this.startedAt === null) return false;
    const held = (now - this.startedAt) / 1000;
    this.render(meterValue(held, this.fillSeconds));
    return meterOverheld(held, this.fillSeconds);
  }

  /** Stop charging and return the timing error in [-1, 1]. */
  release(now: number): number {
    const held = this.startedAt === null ? 0 : (now - this.startedAt) / 1000;
    this.startedAt = null;
    const value = meterValue(held, this.fillSeconds);
    this.render(value);
    // Leave the result on screen briefly so the player can read it.
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.startedAt === null) {
        this.el.style.display = "none";
        this.el.removeAttribute("data-result");
      }
    }, 800);
    return timingErrorFromMeter(value);
  }

  /** Colour the whole bar by how the release went: green, white (slightly off) or a miss. */
  showResult(grade: ReleaseGrade): void {
    const result = grade === "perfect" ? "green" : grade === "slightlyEarly" || grade === "slightlyLate" ? "white" : "miss";
    this.el.classList.remove("in-sweet");
    this.el.setAttribute("data-result", result);
  }

  cancel(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.el.removeAttribute("data-result");
    this.startedAt = null;
    this.el.style.display = "none";
  }

  /** Screen position (CSS px, relative to the canvas container). */
  place(x: number, y: number): void {
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private render(value: number): void {
    const v = Math.min(1, value);
    this.fill.style.transform = `scaleY(${v})`;
    const inSweet = this.green > 0 && Math.abs(value - METER_SWEET_CENTER) <= this.green;
    this.el.classList.toggle("in-sweet", inSweet);
  }
}
