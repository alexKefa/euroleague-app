// WASD / arrows to move, hold Space to shoot, C to cycle the camera.
export interface KeyboardCallbacks {
  shootDown(): void;
  shootUp(): void;
  cycleCamera(): void;
}

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class KeyboardInput {
  private readonly held = new Set<string>();

  constructor(private readonly cb: KeyboardCallbacks) {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** Movement vector: x = right, y = forward, length <= 1. */
  vector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      const k = KEYS[code];
      if (k) {
        x += k[0];
        y += k[1];
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  private onDown = (e: KeyboardEvent) => {
    if (this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code in KEYS) {
      this.held.add(e.code);
      e.preventDefault();
    } else if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) this.cb.shootDown();
    } else if (e.code === "KeyC" && !e.repeat) {
      this.cb.cycleCamera();
    }
  };

  private onUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      this.cb.shootUp();
    }
  };

  private onBlur = () => {
    this.held.clear();
    this.cb.shootUp();
  };
}
