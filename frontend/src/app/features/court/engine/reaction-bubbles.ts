// Emote / quick-phrase bubbles over players' heads (M5). One bubble per
// player: a new reaction replaces the old one. Pops in, holds, fades out.
import { CanvasTexture, SRGBColorSpace, Scene, Sprite, SpriteMaterial, Vector3 } from "three";
import type { EmoteId } from "../../../../../../shared/court/protocol";
import { JERSEY_FONT } from "./avatar-factory";
import { disposeObject } from "./scene-builder";

export const EMOTE_ICONS: Record<EmoteId, string> = {
  shush: "🤫",
  flex: "💪",
  cheer: "🙌",
  shrug: "🤷",
  laugh: "😂",
  fire: "🔥",
};

const EMOTE_MS = 2500;
const PHRASE_MS = 3000;
const POP_MS = 160;
const FADE_MS = 400;
/** Above the name tag (which sits at 2.25 m). */
const BUBBLE_Y = 2.62;

interface Bubble {
  sprite: Sprite;
  baseScale: { x: number; y: number };
  start: number;
  until: number;
}

function bubbleSprite(text: string, icon: boolean): { sprite: Sprite; w: number; h: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = icon ? `84px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif` : `700 46px ${JERSEY_FONT}`;
  ctx.font = font;
  const pad = icon ? 22 : 30;
  const textW = Math.ceil(ctx.measureText(text).width);
  const w = Math.max(icon ? 128 : 0, textW + pad * 2);
  const bodyH = icon ? 120 : 80;
  const tail = 16;
  canvas.width = w;
  canvas.height = bodyH + tail;
  ctx.font = font;
  // Body + a small tail pointing down at the player.
  ctx.fillStyle = icon ? "rgba(255,255,255,0.94)" : "rgba(255,255,255,0.96)";
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, bodyH - 4, Math.min(40, bodyH / 2));
  ctx.moveTo(w / 2 - 14, bodyH - 3);
  ctx.lineTo(w / 2, bodyH + tail - 2);
  ctx.lineTo(w / 2 + 14, bodyH - 3);
  ctx.fill();
  ctx.fillStyle = "#121722";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, bodyH / 2 + (icon ? 4 : 2));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.renderOrder = 3;
  return { sprite, w, h: canvas.height };
}

export class ReactionBubbles {
  private readonly bubbles = new Map<string, Bubble>();
  private readonly tmp = new Vector3();

  constructor(private readonly scene: Scene) {}

  /** Show `text` over player `key` (an emoji when `icon`). */
  show(key: string, text: string, icon: boolean, now: number): void {
    this.remove(key);
    const { sprite, w, h } = bubbleSprite(text, icon);
    const height = icon ? 0.5 : 0.36;
    const baseScale = { x: (height * w) / h, y: height };
    sprite.scale.set(0.01, 0.01, 1);
    sprite.visible = false; // placed on the next update
    this.scene.add(sprite);
    this.bubbles.set(key, { sprite, baseScale, start: now, until: now + (icon ? EMOTE_MS : PHRASE_MS) });
  }

  /** Follow each player; `positionOf` returns null once they're gone. */
  update(now: number, positionOf: (key: string, out: Vector3) => Vector3 | null): void {
    for (const [key, b] of this.bubbles) {
      const at = positionOf(key, this.tmp);
      if (!at || now >= b.until) {
        this.remove(key);
        continue;
      }
      const pop = Math.min(1, (now - b.start) / POP_MS);
      const s = 0.6 + 0.4 * pop * (2 - pop); // ease-out grow
      b.sprite.scale.set(b.baseScale.x * s, b.baseScale.y * s, 1);
      (b.sprite.material as SpriteMaterial).opacity = Math.min(1, (b.until - now) / FADE_MS);
      b.sprite.position.set(at.x, BUBBLE_Y + 0.025 * Math.sin((now - b.start) / 220), at.z);
      b.sprite.visible = true;
    }
  }

  remove(key: string): void {
    const b = this.bubbles.get(key);
    if (!b) return;
    this.scene.remove(b.sprite);
    disposeObject(b.sprite);
    this.bubbles.delete(key);
  }

  dispose(): void {
    for (const key of [...this.bubbles.keys()]) this.remove(key);
  }
}
