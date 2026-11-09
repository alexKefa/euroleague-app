// Hand-rolled floating virtual joystick. Touch anywhere inside `zone` to
// place it; drag to move. Output is x = right, y = forward, length <= 1.
const RADIUS = 56;
const DEAD_ZONE = 0.12;

export class Joystick {
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private x = 0;
  private y = 0;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  constructor(private readonly zone: HTMLElement) {
    this.base = document.createElement("div");
    this.base.className = "court-joy-base";
    this.knob = document.createElement("div");
    this.knob.className = "court-joy-knob";
    this.base.appendChild(this.knob);
    this.base.style.display = "none";
    zone.appendChild(this.base);
    zone.addEventListener("pointerdown", this.onDown);
    zone.addEventListener("pointermove", this.onMove);
    zone.addEventListener("pointerup", this.onUp);
    zone.addEventListener("pointercancel", this.onUp);
    zone.addEventListener("lostpointercapture", this.onUp);
  }

  vector(): { x: number; y: number } {
    const len = Math.hypot(this.x, this.y);
    if (len < DEAD_ZONE) return { x: 0, y: 0 };
    // Rescale past the dead zone so small pushes still give fine control.
    const k = (len - DEAD_ZONE) / (1 - DEAD_ZONE) / len;
    return { x: this.x * k, y: this.y * k };
  }

  dispose(): void {
    this.zone.removeEventListener("pointerdown", this.onDown);
    this.zone.removeEventListener("pointermove", this.onMove);
    this.zone.removeEventListener("pointerup", this.onUp);
    this.zone.removeEventListener("pointercancel", this.onUp);
    this.zone.removeEventListener("lostpointercapture", this.onUp);
    this.base.remove();
  }

  private onDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    const rect = this.zone.getBoundingClientRect();
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.base.style.display = "block";
    this.base.style.left = `${e.clientX - rect.left}px`;
    this.base.style.top = `${e.clientY - rect.top}px`;
    this.setKnob(0, 0);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    this.setKnob(dx, dy);
    this.x = dx / RADIUS;
    this.y = -dy / RADIUS;
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.base.style.display = "none";
  };

  private setKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
