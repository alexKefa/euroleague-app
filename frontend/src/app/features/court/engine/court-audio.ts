// Synthesised court sounds (WebAudio, no asset files). The context is created
// on the first user gesture (browsers block audio before one).
import { ShotEventKind } from "../../../../../../shared/court/types";

export class CourtAudio {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Call from a user gesture (shoot press). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  play(kind: ShotEventKind, strength = 3): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const vol = Math.min(1, 0.25 + strength / 8);
    const t = ctx.currentTime;
    switch (kind) {
      case "make":
        this.noiseBurst(t, 0.32, "bandpass", 4200, 0.9, 0.55);
        this.noiseBurst(t + 0.04, 0.22, "highpass", 6500, 0.7, 0.25);
        break;
      case "rim":
        this.tone(t, 640, 0.22, 0.32 * vol, "triangle");
        this.tone(t, 1530, 0.14, 0.16 * vol, "sine");
        this.noiseBurst(t, 0.03, "highpass", 3000, 0.7, 0.2 * vol);
        break;
      case "board":
        this.noiseBurst(t, 0.12, "lowpass", 700, 0.8, 0.6 * vol);
        this.tone(t, 160, 0.1, 0.3 * vol, "sine");
        break;
      case "ground":
        this.tone(t, 120, 0.14, 0.55 * vol, "sine", 55);
        this.noiseBurst(t, 0.04, "lowpass", 900, 0.7, 0.25 * vol);
        break;
      case "pole":
        this.tone(t, 330, 0.35, 0.3 * vol, "triangle");
        this.tone(t, 890, 0.25, 0.12 * vol, "sine");
        break;
      case "fence":
        this.noiseBurst(t, 0.25, "highpass", 2500, 0.5, 0.25 * vol);
        break;
    }
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType, endFreq?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
