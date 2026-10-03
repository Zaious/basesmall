// Hit and home-run sounds, synthesized with Web Audio: no sound files, nothing to license.
// Quiet and short on purpose; sound starts muted (PRD §6).

export type SoundName = 'hit' | 'homeRun' | 'strike' | 'fullCount' | 'bunt' | 'strikeout';

export interface SoundOptions {
  muted: boolean; volume: number; hit: boolean; homeRun: boolean;
  strike: boolean; fullCount: boolean; bunt: boolean; strikeout: boolean;
}

export class Sounds {
  private ctx: AudioContext | null = null;
  private opts: SoundOptions = { muted: true, volume: 0.6, hit: true, homeRun: true, strike: false, fullCount: false, bunt: false, strikeout: false };
  private noise: AudioBuffer | null = null;

  setOptions(o: SoundOptions): void { this.opts = { ...o }; }

  /** 'running', 'suspended' (the web view wants a click first), or 'none' before the first sound. */
  get state(): string { return this.ctx?.state ?? 'none'; }

  /** Create or wake the audio context. Call it from a click: web views may only start audio then. */
  prime(): void { this.context(); }

  /** Whether this sound would play with the current settings. */
  enabled(name: SoundName): boolean {
    return !this.opts.muted && this.opts.volume > 0 && this.opts[name];
  }

  /** Play a sound if it is switched on. `preview` plays it even when muted (the settings screen). */
  play(name: SoundName, preview = false): void {
    if (!preview && !this.enabled(name)) return;
    const ctx = this.context();
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.value = Math.max(0.05, this.opts.volume) * 0.5;
    out.connect(ctx.destination);
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'hit': this.crack(ctx, out, t); break;
      case 'homeRun': this.crack(ctx, out, t); this.chime(ctx, out, t + 0.32); break;
      case 'strike': this.pop(ctx, out, t, 0.7); break;
      case 'strikeout': this.pop(ctx, out, t, 0.8); this.fall(ctx, out, t + 0.12); break;
      case 'bunt': this.tap(ctx, out, t); break;
      case 'fullCount': this.hum(ctx, out, t); break;
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const n = Math.floor(ctx.sampleRate * 0.08);
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    }
    return this.noise;
  }

  /** A catcher's mitt: low, dull, short. */
  private pop(ctx: AudioContext, out: AudioNode, t: number, level: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(low).connect(g).connect(out);
    src.start(t); src.stop(t + 0.07);
    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(140, t);
    body.frequency.exponentialRampToValueAtTime(80, t + 0.05);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(level * 0.6, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    body.connect(bg).connect(out);
    body.start(t); body.stop(t + 0.09);
  }

  /** A short falling note after the mitt: that's three. */
  private fall(ctx: AudioContext, out: AudioNode, t: number): void {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.32);
  }

  /** A bunt: a light, high tick, no thump. */
  private tap(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1300; band.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(band).connect(g).connect(out);
    src.start(t); src.stop(t + 0.04);
  }

  /** Full count: a low, soft swell, two notes a minor third apart. Tension, not alarm. */
  private hum(ctx: AudioContext, out: AudioNode, t: number): void {
    for (const f of [196, 233.08]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.95);
    }
  }

  private context(): AudioContext | null {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** The bat: a short band-passed noise burst over a low thump. */
  private crack(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 2400; band.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(band).connect(g).connect(out);
    src.start(t); src.stop(t + 0.08);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(190, t);
    thump.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    thump.connect(tg).connect(out);
    thump.start(t); thump.stop(t + 0.1);
  }

  /** Two soft rising notes after the crack: gone, not a fanfare. */
  private chime(ctx: AudioContext, out: AudioNode, t: number): void {
    [659.25, 987.77].forEach((f, i) => {
      const at = t + i * 0.16;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.35, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      o.connect(g).connect(out);
      o.start(at); o.stop(at + 0.45);
    });
  }
}
