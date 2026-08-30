import { Component, Input, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { PlayerShot } from "../../core/models";
import { I18nService } from "../../core/i18n.service";
import { ChipDirective } from "../../shared/chip.directive";

// EuroLeague's shot feed uses a coordinate system in cm, origin at the
// basket, Y increasing away from the hoop toward half-court (confirmed
// empirically: 3PT-attempt distances cluster at 677-826, matching FIBA's
// 675cm arc radius). This draws a half-court diagram at 1 SVG unit = 5cm
// and plots each shot at its real position — no external charting library,
// same hand-rolled-SVG approach as the rest of this app's icons/charts.
// Court markings (key, arcs, restricted area) are close approximations of
// FIBA dimensions, not laser-precise — good enough to read as "a court",
// not a regulation blueprint.
type ShotFilter = "all" | "made" | "missed";

@Component({
  selector: "app-shot-chart",
  standalone: true,
  imports: [CommonModule, ChipDirective],
  templateUrl: "./shot-chart.html",
})
export class ShotChartComponent {
  protected i18n = inject(I18nService);

  @Input() shots: PlayerShot[] = [];
  // A faded watermark behind the court — purely cosmetic, so a missing/failed
  // load just means no watermark rather than needing retry-img's robustness.
  @Input() photoUrl: string | null = null;

  // Unique per instance so two shot charts on the same page (not currently
  // possible, but cheap to guard) don't fight over one <clipPath> id.
  readonly photoClipId = "shot-chart-photo-" + Math.random().toString(36).slice(2);

  readonly filter = signal<ShotFilter>("all");
  readonly filteredShots = computed(() => {
    const f = this.filter();
    if (f === "all") return this.shots;
    return this.shots.filter((s) => (f === "made" ? s.made : !s.made));
  });

  setFilter(f: ShotFilter): void {
    this.filter.set(f);
  }

  readonly hovered = signal<number | null>(null);

  // --- Court geometry (all in SVG units, 1 unit = 5cm) ---
  readonly viewBoxWidth = 320;
  readonly viewBoxHeight = 210;
  private readonly unit = 5;
  readonly basketX = this.viewBoxWidth / 2;
  readonly basketY = 185;

  readonly baselineY = this.viewBoxHeight;
  readonly backboardY = this.basketY + 3;
  readonly backboardX1 = this.basketX - 18;
  readonly backboardX2 = this.basketX + 18;
  readonly rimRadius = 4.5;

  readonly restrictedAreaRadius = 25;
  readonly restrictedAreaLeftX = this.basketX - this.restrictedAreaRadius;
  readonly restrictedAreaRightX = this.basketX + this.restrictedAreaRadius;

  readonly keyHalfWidth = 49;
  readonly keyLeftX = this.basketX - this.keyHalfWidth;
  readonly keyWidth = this.keyHalfWidth * 2;
  readonly freeThrowLineY = 96;
  readonly keyHeight = this.baselineY - this.freeThrowLineY;
  readonly freeThrowCircleRadius = 18;

  readonly threePointRadius = 135;
  // FIBA's corner-3 line runs straight, parallel to the sideline, from the
  // baseline up to where it meets the arc — not a uniform arc all the way
  // to the baseline like this would otherwise draw as a plain semicircle.
  readonly threePointCornerX = this.basketX + 132; // ~660cm from center, 90cm off the 750cm sideline
  private readonly cornerArcMeetY = Math.sqrt(this.threePointRadius ** 2 - 132 ** 2);
  readonly threePointArcTopY = this.basketY - this.cornerArcMeetY;
  readonly threePointLeftCornerX = this.basketX - 132;

  readonly courtOutlinePath = `
    M 6 ${this.baselineY}
    L 6 6
    L ${this.viewBoxWidth - 6} 6
    L ${this.viewBoxWidth - 6} ${this.baselineY}
  `;

  readonly threePointArcPath = `
    M ${this.threePointLeftCornerX} ${this.baselineY}
    L ${this.threePointLeftCornerX} ${this.threePointArcTopY}
    A ${this.threePointRadius} ${this.threePointRadius} 0 0 1 ${this.threePointCornerX} ${this.threePointArcTopY}
    L ${this.threePointCornerX} ${this.baselineY}
  `;

  readonly restrictedAreaPath = `M ${this.restrictedAreaLeftX} ${this.basketY} A ${this.restrictedAreaRadius} ${this.restrictedAreaRadius} 0 0 1 ${this.restrictedAreaRightX} ${this.basketY}`;

  // Centered over the court as a big, subtle watermark — not tied to any
  // particular shot cluster, just a "whose chart is this" cue at a glance.
  readonly photoCx = this.viewBoxWidth / 2;
  readonly photoCy = 100;
  readonly photoRadius = 85;

  readonly attempts = computed(() => this.shots.length);
  readonly made = computed(() => this.shots.filter((s) => s.made).length);
  readonly pct = computed(() => (this.attempts() > 0 ? Math.round((this.made() / this.attempts()) * 1000) / 10 : null));

  // Zone efficiency — a distance-from-basket rollup of the same shot data
  // above (no new fields synced), standing in for the arc/depth/left-right
  // sensor readouts a real shooting-machine display would show, which
  // EuroLeague's feed has no equivalent of. Boundaries are a rough analogue
  // of paint/mid-range/three (in cm, same coordinate system as x/y above),
  // not FIBA key geometry — good enough to bucket shots, not to redraw the
  // key from.
  private zoneFor(shot: PlayerShot): "paint" | "mid" | "three" {
    const distance = Math.hypot(shot.x, shot.y);
    if (distance < 150) return "paint";
    if (distance < 650) return "mid";
    return "three";
  }

  private zoneStats(zone: "paint" | "mid" | "three"): { made: number; attempts: number; pct: number } {
    const zoneShots = this.shots.filter((s) => this.zoneFor(s) === zone);
    const made = zoneShots.filter((s) => s.made).length;
    const attempts = zoneShots.length;
    return { made, attempts, pct: attempts > 0 ? Math.round((made / attempts) * 100) : 0 };
  }

  readonly paintStats = computed(() => this.zoneStats("paint"));
  readonly midStats = computed(() => this.zoneStats("mid"));
  readonly threeStats = computed(() => this.zoneStats("three"));

  toSvgX(x: number): number {
    return this.basketX + x / this.unit;
  }

  toSvgY(y: number): number {
    return this.basketY - y / this.unit;
  }
}
