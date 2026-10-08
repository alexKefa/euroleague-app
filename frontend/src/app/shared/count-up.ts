import { Component, ElementRef, OnDestroy, effect, inject, input, untracked } from "@angular/core";

// Rolls a number from its previous value to the new one (2026-10-08, first
// GSAP animation, trial run on the points badges). GSAP is imported lazily
// so it lands in its own chunk instead of the already over-budget initial
// bundle. The first value counts up from 0; later changes from the last
// shown value. Reduced motion (or GSAP failing to load) just sets the text.
@Component({
  selector: "app-count-up",
  standalone: true,
  // inline-block so a pop's scale transform applies to the number.
  host: { class: "tabular-nums inline-block" },
  template: "0",
})
export class CountUpComponent implements OnDestroy {
  readonly value = input.required<number>();
  readonly duration = input(0.9);
  // false: the first value appears as-is and only later changes roll (live
  // scores — replaying 0→78 on every dashboard visit would be noise).
  readonly fromZero = input(true);
  // Starting value for the first roll (default 0). Ranks start above the
  // target so they count *down* to it — climbing to #12, not up from #0.
  readonly from = input(0);
  // Pop (scale up, settle) on every change after the first — for small
  // jumps like a +2 basket, where the roll alone is only a frame or two.
  readonly pop = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private shown = 0;
  private first = true;
  private tween?: { kill(): void };
  private popTween?: { kill(): void };

  private readonly animate = effect(() => {
    const target = this.value();
    const el = this.host.nativeElement;
    untracked(() => this.run(el, target));
  });

  private async run(el: HTMLElement, target: number): Promise<void> {
    this.tween?.kill();
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const skipFirst = this.first && !this.fromZero();
    if (this.first) this.shown = this.from();
    this.first = false;
    if (reduce || skipFirst || target === this.shown) {
      this.shown = target;
      el.textContent = String(target);
      return;
    }
    try {
      const { gsap } = await import("gsap");
      const counter = { n: this.shown };
      this.tween = gsap.to(counter, {
        n: target,
        duration: this.duration(),
        ease: "power2.out",
        onUpdate: () => {
          this.shown = Math.round(counter.n);
          el.textContent = String(this.shown);
        },
      });
      if (this.pop()) {
        this.popTween?.kill();
        gsap.set(el, { clearProps: "transform,color" });
        // GSAP can't tween a CSS variable, so resolve the team colour and
        // the number's resting colour to real values first.
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim();
        const rest = getComputedStyle(el).color;
        this.popTween = gsap.fromTo(
          el,
          { scale: 1.4, color: accent || rest },
          { scale: 1, color: rest, duration: 0.6, ease: "back.out(3)", clearProps: "transform,color" },
        );
      }
    } catch {
      this.shown = target;
      el.textContent = String(target);
    }
  }

  ngOnDestroy(): void {
    this.tween?.kill();
    this.popTween?.kill();
  }
}
