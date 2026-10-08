import { Component, ElementRef, OnDestroy, effect, inject, input, untracked } from "@angular/core";

// Rolls a number from its previous value to the new one (2026-10-08, first
// GSAP animation, trial run on the points badges). GSAP is imported lazily
// so it lands in its own chunk instead of the already over-budget initial
// bundle. The first value counts up from 0; later changes from the last
// shown value. Reduced motion (or GSAP failing to load) just sets the text.
@Component({
  selector: "app-count-up",
  standalone: true,
  host: { class: "tabular-nums" },
  template: "0",
})
export class CountUpComponent implements OnDestroy {
  readonly value = input.required<number>();
  readonly duration = input(0.9);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private shown = 0;
  private tween?: { kill(): void };

  private readonly animate = effect(() => {
    const target = this.value();
    const el = this.host.nativeElement;
    untracked(() => this.run(el, target));
  });

  private async run(el: HTMLElement, target: number): Promise<void> {
    this.tween?.kill();
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target === this.shown) {
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
    } catch {
      this.shown = target;
      el.textContent = String(target);
    }
  }

  ngOnDestroy(): void {
    this.tween?.kill();
  }
}
