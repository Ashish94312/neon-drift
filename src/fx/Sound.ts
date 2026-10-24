// All audio is synthesized with Web Audio: no sound files, nothing to inline.
// The context starts on the first key/pointer press (browser autoplay rules).
import { loadFlag, saveFlag } from "../systems/Save";

export type SoundMode = "title" | "race" | "paused" | "over";

const MUTE_KEY = "neon-drift.muted";
const MASTER = 0.8;
const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// Am – F – C – G, one bar each. Bass roots, pad voicings, arpeggio tones (MIDI numbers).
const BARS = [
  { root: 45, pad: [57, 60, 64], arp: [69, 72, 76] },
  { root: 41, pad: [53, 57, 60], arp: [65, 69, 72] },
  { root: 48, pad: [55, 60, 64], arp: [72, 76, 79] },
  { root: 43, pad: [55, 59, 62], arp: [67, 71, 74] },
];
const BPM = 104;
const STEP = 60 / BPM / 4; // sixteenth note
const ARP_PATTERN = [0, 1, 2, 1];

interface Engine {
  gain: GainNode;
  filter: BiquadFilterNode;
  saws: OscillatorNode[];
  sub: OscillatorNode;
  hissGain: GainNode;
  hissFilter: BiquadFilterNode;
}

export class Sound {
  muted = loadFlag(MUTE_KEY);
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private bassFilter!: BiquadFilterNode;
  private padFilter!: BiquadFilterNode;
  private arpFilter!: BiquadFilterNode;
  private sfx!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private engine!: Engine;
  private mode: SoundMode = "title";
  private step = 0;
  private nextTime = 0;
  private lastEngineUpdate = 0;
  private lastScrape = 0;

  constructor() {
    const unlock = () => this.unlock();
    addEventListener("pointerdown", unlock);
    addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  private unlock(): void {
    if (!this.ctx) {
      try {
        this.build();
      } catch {
        return; // no Web Audio: play silently
      }
    }
    if (this.ctx!.state === "suspended" && !document.hidden) this.ctx!.resume();
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = this.gain(this.muted ? 0 : MASTER, comp);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Short synthetic room: decaying stereo noise as the impulse response.
    const reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    reverb.connect(this.gain(0.3, this.master));
    this.reverbSend = this.gain(0.35, reverb);

    this.musicFilter = this.filter("lowpass", 18000, this.master);
    this.musicFilter.connect(this.reverbSend);
    this.music = this.gain(0.32, this.musicFilter);
    this.bassFilter = this.filter("lowpass", 650, this.music);
    this.padFilter = this.filter("lowpass", 1400, this.music);
    this.arpFilter = this.filter("lowpass", 2600, this.music);
    this.sfx = this.gain(0.9, this.master);

    this.engine = this.buildEngine();
    this.nextTime = ctx.currentTime + 0.1;
    setInterval(() => this.schedule(), 25);
  }

  private buildEngine(): Engine {
    const ctx = this.ctx!;
    const gain = this.gain(0, this.master);
    const filter = this.filter("lowpass", 300, gain);
    filter.Q.value = 3;
    const saws = [0, 12].map((detune) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 46;
      o.detune.value = detune;
      o.connect(filter);
      o.start();
      return o;
    });
    const sub = ctx.createOscillator();
    sub.frequency.value = 23;
    sub.connect(filter);
    sub.start();
    // Hover wobble.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const depth = this.gain(1.5);
    lfo.connect(depth);
    saws.forEach((s) => depth.connect(s.frequency));
    lfo.start();
    // Air rushing past: looped noise through a band-pass that opens with speed.
    const hissGain = this.gain(0, this.master);
    const hissFilter = this.filter("bandpass", 800, hissGain);
    hissFilter.Q.value = 0.7;
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    hiss.connect(hissFilter);
    hiss.start();
    return { gain, filter, saws, sub, hissGain, hissFilter };
  }

  // ---------- helpers ----------

  private gain(value: number, dest?: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.connect(dest);
    return f;
  }

  private tone(type: OscillatorType, freq: number, t: number, dur: number, peak: number, dest: AudioNode, attack = 0.005, detune = 0, freqEnd?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(t: number, dur: number, type: BiquadFilterType, freq: number, peak: number, dest: AudioNode, freqEnd?: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  }

  private get now(): number {
    return this.ctx!.currentTime;
  }

  private get ready(): boolean {
    return this.ctx?.state === "running";
  }

  // ---------- music ----------

  private schedule(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.02; // resumed after a gap
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (BARS.length * 16);
    }
  }

  private playStep(step: number, t: number): void {
    const bar = BARS[Math.floor(step / 16)];
    const s = step % 16;
    const racing = this.mode === "race" || this.mode === "paused";

    if (s === 0) {
      for (const n of bar.pad) {
        for (const detune of [-9, 9]) this.tone("sawtooth", NOTE(n), t, STEP * 16, 0.022, this.padFilter, 0.6, detune);
      }
    }
    if (this.mode !== "over" && s % 2 === 0) {
      // Octave-jumping synthwave bass on eighths.
      this.tone("sawtooth", NOTE(bar.root + (s % 4 === 2 ? 12 : 0)), t, 0.2, racing ? 0.16 : 0.1, this.bassFilter);
    }
    if (!racing) return;
    this.tone("square", NOTE(bar.arp[ARP_PATTERN[s % 4]] + (s >= 8 ? 12 : 0)), t, 0.13, 0.035, this.arpFilter);
    if (s === 0 || s === 8) this.tone("sine", 140, t, 0.35, 0.9, this.music, 0.002, 0, 45);
    if (s === 4 || s === 12) {
      this.burst(t, 0.18, "bandpass", 1800, 0.45, this.music, undefined, 0.8);
      this.tone("triangle", 190, t, 0.1, 0.18, this.music);
    }
    this.burst(t, 0.04, "highpass", 7000, s % 2 === 0 ? 0.1 : 0.04, this.music);
  }

  // ---------- state ----------

  setMode(mode: SoundMode): void {
    this.mode = mode;
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(mode === "paused" ? 450 : 18000, this.now, 0.15);
    this.music.gain.setTargetAtTime(mode === "over" ? 0.22 : 0.32, this.now, 0.3);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    saveFlag(MUTE_KEY, this.muted);
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, this.now, 0.05);
    return this.muted;
  }

  /** Called every frame; engine parameters are refreshed ~20 times a second. */
  update(speedNorm: number, boosting: boolean): void {
    if (!this.ready || this.now - this.lastEngineUpdate < 0.05) return;
    this.lastEngineUpdate = this.now;
    const e = this.engine;
    const t = this.now;
    const over = this.mode === "over";
    const level = { title: 0.05, race: 0.075, paused: 0, over: 0 }[this.mode];
    const f = over ? 18 : 46 + 58 * speedNorm + (boosting ? 18 : 0);
    const k = over ? 0.6 : 0.1;
    e.saws.forEach((s) => s.frequency.setTargetAtTime(f, t, k));
    e.sub.frequency.setTargetAtTime(f / 2, t, k);
    e.filter.frequency.setTargetAtTime(250 + 1600 * speedNorm + (boosting ? 1800 : 0), t, 0.1);
    e.gain.gain.setTargetAtTime(level * (0.7 + 0.3 * speedNorm), t, over ? 0.5 : 0.15);
    e.hissFilter.frequency.setTargetAtTime(700 + 2600 * speedNorm, t, 0.1);
    const hiss = this.mode === "race" || this.mode === "title" ? 0.015 + 0.04 * speedNorm + (boosting ? 0.04 : 0) : 0;
    e.hissGain.gain.setTargetAtTime(hiss, t, 0.2);
  }

  // ---------- effects ----------

  confirm(): void {
    if (!this.ready) return;
    this.tone("square", NOTE(84), this.now, 0.07, 0.07, this.sfx);
    this.tone("square", NOTE(91), this.now + 0.05, 0.09, 0.06, this.sfx);
  }

  boost(): void {
    if (!this.ready) return;
    this.burst(this.now, 0.7, "bandpass", 400, 0.5, this.sfx, 4000, 1.2);
    this.tone("sawtooth", 110, this.now, 0.5, 0.08, this.sfx, 0.02, 0, 440);
  }

  pickup(): void {
    if (!this.ready) return;
    this.tone("triangle", NOTE(88), this.now, 0.18, 0.2, this.sfx);
    this.tone("triangle", NOTE(95), this.now + 0.07, 0.28, 0.17, this.sfx);
    this.tone("sine", NOTE(100), this.now + 0.07, 0.35, 0.06, this.reverbSend);
  }

  /** dx: barrier x minus craft x, so the swoosh pans to the side it passed on. */
  closeCall(dx: number): void {
    if (!this.ready) return;
    const pan = this.ctx!.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / 3));
    pan.connect(this.sfx);
    this.burst(this.now, 0.32, "bandpass", 2600, 0.4, pan, 500, 1.5);
  }

  hit(): void {
    if (!this.ready) return;
    const t = this.now;
    this.tone("sine", 120, t, 0.45, 0.9, this.sfx, 0.002, 0, 38);
    this.burst(t, 0.4, "lowpass", 1400, 0.6, this.sfx, 200);
    this.tone("square", 62, t, 0.15, 0.12, this.sfx);
  }

  zap(): void {
    if (!this.ready) return;
    this.tone("square", 1400, this.now, 0.25, 0.12, this.sfx, 0.002, 0, 90);
    this.burst(this.now, 0.2, "highpass", 4000, 0.2, this.sfx);
  }

  wreck(): void {
    if (!this.ready) return;
    this.hit();
    this.burst(this.now, 1.6, "lowpass", 900, 0.5, this.sfx, 90);
    this.burst(this.now + 0.05, 1.2, "bandpass", 3000, 0.12, this.reverbSend, 600);
  }

  scrape(): void {
    if (!this.ready || this.now - this.lastScrape < 0.15) return;
    this.lastScrape = this.now;
    this.burst(this.now, 0.14, "highpass", 3200, 0.14, this.sfx);
  }

  milestone(): void {
    if (!this.ready) return;
    [76, 83, 88].forEach((n, i) => {
      this.tone("triangle", NOTE(n), this.now + i * 0.09, 0.4, 0.14, this.sfx);
      this.tone("triangle", NOTE(n), this.now + i * 0.09, 0.4, 0.05, this.reverbSend);
    });
  }
}
