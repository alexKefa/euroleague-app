// Hold-and-release shoot meter (CLUTCH_COURT_SPEC.md §5.2). Owns the meter
// DOM directly (it changes every frame, so it never goes through Angular).
import {
  METER_SWEET_CENTER,
  METER_SWEET_HALF_WIDTH,
} from "../../../../../../../shared/court/constants";
import { meterOverheld, meterValue, timingErrorFromMeter } from "../../../../../../../shared/court/shot";

export class ShootMeter {
  private startedAt: number | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly fill: HTMLElement
  ) {
    el.style.setProperty("--sweet-bottom", `${(METER_SWEET_CENTER - METER_SWEET_HALF_WIDTH) * 100}%`);
    el.style.setProperty("--sweet-height", `${METER_SWEET_HALF_WIDTH * 2 * 100}%`);
  }

  get charging(): boolean {
    return this.startedAt !== null;
  }

  start(now: number): void {
    this.startedAt = now;
    this.el.style.display = "block";
    this.render(0);
  }

  /** Per frame. Returns true when the hold went past the top and must auto-release. */
  update(now: number): boolean {
    if (this.startedAt === null) return false;
    const held = (now - this.startedAt) / 1000;
    this.render(meterValue(held));
    return meterOverheld(held);
  }

  /** Stop charging and return the timing error in [-1, 1]. */
  release(now: number): number {
    const held = this.startedAt === null ? 0 : (now - this.startedAt) / 1000;
    this.startedAt = null;
    const value = meterValue(held);
    this.render(value);
    // Leave the final position visible briefly so the player can read it.
    window.setTimeout(() => {
      if (this.startedAt === null) this.el.style.display = "none";
    }, 450);
    return timingErrorFromMeter(value);
  }

  cancel(): void {
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
    const inSweet = Math.abs(value - METER_SWEET_CENTER) <= METER_SWEET_HALF_WIDTH;
    this.el.classList.toggle("in-sweet", inSweet);
  }
}
