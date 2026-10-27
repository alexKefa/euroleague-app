import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from "@angular/core";

/**
 * Album Series 2: the fire behind an owned MVP moment's player (design B from
 * the 2026-10-27 mockup, with smaller flames). One low-res "Doom fire" heat
 * simulation feeds every burning card on screen: each frame is drawn once to
 * an offscreen canvas and copied into every attached card canvas, so a page
 * full of MVPs costs about the same as one. Runs at ~30fps outside Angular's
 * zone, stops when no card is attached, and shows a still frame under
 * prefers-reduced-motion.
 */
const W = 56;
const H = 40;
const DECAY = 2; // higher = shorter flames

const STOPS = [
  [0, 0, 0, 0],
  [70, 4, 8, 120],
  [150, 14, 18, 200],
  [210, 40, 22, 235],
  [240, 96, 28, 250],
  [255, 156, 52, 255],
  [255, 212, 120, 255],
  [255, 246, 214, 255],
];
const PALETTE = Array.from({ length: 37 }, (_, i) => {
  const t = (i / 36) * (STOPS.length - 1);
  const k = Math.floor(t);
  const f = t - k;
  const a = STOPS[k];
  const b = STOPS[Math.min(k + 1, STOPS.length - 1)];
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
});

class FireEngine {
  private readonly heat = new Uint8Array(W * H);
  private source: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;
  private readonly targets = new Set<HTMLCanvasElement>();
  private frame = 0;
  private last = 0;
  private warmed = false;

  attach(canvas: HTMLCanvasElement): () => void {
    canvas.width = W;
    canvas.height = H;
    this.ensureSource();
    this.targets.add(canvas);
    this.draw(canvas);
    if (this.targets.size === 1 && !this.reducedMotion()) this.frame = requestAnimationFrame(this.loop);
    return () => {
      this.targets.delete(canvas);
      if (this.targets.size === 0) cancelAnimationFrame(this.frame);
    };
  }

  private reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private ensureSource(): void {
    if (this.source) return;
    this.source = document.createElement("canvas");
    this.source.width = W;
    this.source.height = H;
    this.image = this.source.getContext("2d")!.createImageData(W, H);
    if (!this.warmed) {
      for (let i = 0; i < 80; i++) this.step();
      this.warmed = true;
    }
    this.render();
  }

  private readonly loop = (t: number): void => {
    if (t - this.last > 33) {
      this.last = t;
      this.step();
      this.render();
      for (const canvas of this.targets) this.draw(canvas);
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  private step(): void {
    const heat = this.heat;
    for (let x = 0; x < W; x++) heat[(H - 1) * W + x] = 36;
    for (let x = 0; x < W; x++) {
      for (let y = 1; y < H; y++) {
        const src = y * W + x;
        const r = (Math.random() * 3) | 0;
        const dst = src - r + 1 - W;
        if (dst < 0) continue;
        heat[dst] = Math.max(0, heat[src] - ((r & 1) * DECAY + (Math.random() < 0.12 ? 1 : 0)));
      }
    }
  }

  private render(): void {
    const data = this.image!.data;
    for (let i = 0; i < this.heat.length; i++) data.set(PALETTE[this.heat[i]], i * 4);
    this.source!.getContext("2d")!.putImageData(this.image!, 0, 0);
  }

  private draw(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx || !this.source) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.source, 0, 0);
  }
}

const engine = new FireEngine();

/** `<canvas appMvpFire>`: joins the shared MVP fire for as long as it's on screen. */
@Directive({ selector: "canvas[appMvpFire]", standalone: true })
export class MvpFireDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLCanvasElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private detach: (() => void) | null = null;

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => (this.detach = engine.attach(this.el.nativeElement)));
  }

  ngOnDestroy(): void {
    this.detach?.();
  }
}
