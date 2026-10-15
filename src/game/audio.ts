// Fully synthesized sound design (WebAudio) — no assets.
// Direction: Armored Core style mechanical weapon foley + Halo style clean UI/shield tones.
import { store } from './store';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private droneNodes: AudioNode[] = [];
  private droneOn = false;
  private lastPlay = new Map<string, number>();

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.applyVolumes();
  }

  resume() { this.ctx?.resume().catch(() => {}); }

  applyVolumes() {
    if (!this.ctx) return;
    const s = store.settings;
    this.master.gain.value = s.master;
    this.sfxBus.gain.value = s.sfx;
    this.musicBus.gain.value = s.music * 0.5;
  }

  private noise(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? 0;
    if (now - last < ms) return true;
    this.lastPlay.set(key, now);
    return false;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, dest?: AudioNode, freqEnd?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    this.env(g, t, 0.004, peak, dur);
    o.connect(g).connect(dest ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(t: number, dur: number, peak: number, filterFreq: number, q = 1, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.003, peak, dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---------- weapons ----------
  shotAR() {
    if (!this.ctx || this.throttle('ar', 40)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.07, 0.5, 2400, 0.8);
    this.osc('square', 190, t, 0.05, 0.28, undefined, 90);
    this.osc('sine', 70, t, 0.08, 0.5, undefined, 45);
  }

  shotShotgun() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.32, 0.9, 900, 0.6);
    this.burst(t, 0.12, 0.6, 4200, 1);
    this.osc('sine', 120, t, 0.28, 0.9, undefined, 38);
    this.osc('sawtooth', 60, t, 0.2, 0.3, undefined, 30);
  }

  shotSniper() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.09, 0.9, 5200, 1.2, 'highpass');
    this.burst(t, 0.55, 0.5, 700, 0.5);
    this.osc('sine', 220, t, 0.5, 0.6, undefined, 40);
    this.osc('triangle', 1800, t, 0.4, 0.12, undefined, 300);
  }

  dryFire() {
    if (!this.ctx || this.throttle('dry', 120)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 900, t, 0.04, 0.15, undefined, 500);
  }

  cooldownReady() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 880, t, 0.09, 0.2);
    this.osc('sine', 1320, t + 0.08, 0.14, 0.18);
  }

  // ---------- shields ----------
  shieldWrong() {
    if (!this.ctx || this.throttle('wrong', 90)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 220, t, 0.1, 0.25, undefined, 180);
    this.osc('square', 233, t, 0.1, 0.25, undefined, 190); // dissonant clank
    this.burst(t, 0.06, 0.2, 3000, 3);
  }

  shieldHit() {
    if (!this.ctx || this.throttle('shit', 60)) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 1180, t, 0.1, 0.22, undefined, 900);
    this.burst(t, 0.07, 0.22, 5000, 2, 'bandpass');
  }

  shieldBreak() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // glassy Halo-style shimmer
    [1567, 1244, 932, 622].forEach((f, i) => this.osc('sine', f, t + i * 0.03, 0.5, 0.3, undefined, f * 0.5));
    this.burst(t, 0.5, 0.4, 6000, 1.4, 'highpass');
    this.osc('sine', 90, t, 0.4, 0.5, undefined, 40);
  }

  // ---------- combat feedback ----------
  hitmarker() {
    if (!this.ctx || this.throttle('hm', 45)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 2100, t, 0.03, 0.14);
  }

  kill() {
    if (!this.ctx || this.throttle('kill', 80)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 520, t, 0.07, 0.25, undefined, 240);
    this.osc('sine', 180, t, 0.15, 0.4, undefined, 60);
  }

  explosion() {
    if (!this.ctx || this.throttle('exp', 70)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.7, 0.8, 300, 0.5);
    this.osc('sine', 100, t, 0.6, 0.8, undefined, 30);
  }

  parry() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // the big TING
    this.osc('sine', 2637, t, 0.9, 0.4);
    this.osc('sine', 3520, t, 0.6, 0.25);
    this.osc('sine', 1318, t, 1.0, 0.3);
    this.burst(t, 0.1, 0.4, 7000, 2, 'highpass');
    this.osc('sine', 65, t, 0.3, 0.6, undefined, 45);
  }

  parryFail() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('square', 300, t, 0.08, 0.15, undefined, 200);
  }

  hurt() {
    if (!this.ctx || this.throttle('hurt', 150)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.2, 0.6, 500, 0.8);
    this.osc('sawtooth', 140, t, 0.18, 0.3, undefined, 60);
  }

  dash() {
    if (!this.ctx || this.throttle('dash', 150)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.22, 0.35, 1200, 0.7, 'bandpass');
  }

  slide() {
    if (!this.ctx || this.throttle('slide', 300)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.35, 0.2, 800, 0.5);
  }

  // elite sidestep: sharp servo whoosh + low metallic chirp
  dodge() {
    if (!this.ctx || this.throttle('dodge', 200)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.16, 0.3, 2400, 0.9, 'bandpass');
    this.osc('square', 880, t, 0.07, 0.12, undefined, 1320);
  }

  jump() {
    if (!this.ctx || this.throttle('jump', 150)) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.1, 0.15, 1500, 0.8, 'bandpass');
  }

  slam() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.4, 0.7, 350, 0.6);
    this.osc('sine', 80, t, 0.35, 0.7, undefined, 30);
  }

  enemyShoot() {
    if (!this.ctx || this.throttle('eshoot', 120)) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 600, t, 0.15, 0.12, undefined, 200);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 660, t, 0.08, 0.25);
    this.osc('sine', 990, t + 0.07, 0.12, 0.25);
  }

  // ---------- UI / flow ----------
  uiMove() {
    if (!this.ctx || this.throttle('uim', 40)) return;
    this.osc('sine', 740, this.ctx.currentTime, 0.05, 0.1);
  }

  uiSelect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 587, t, 0.08, 0.2);
    this.osc('sine', 880, t + 0.05, 0.14, 0.2);
  }

  uiBack() {
    if (!this.ctx) return;
    this.osc('sine', 440, this.ctx.currentTime, 0.1, 0.18, undefined, 300);
  }

  wheelOpen() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 220, t, 0.3, 0.15, undefined, 440);
  }

  wheelSelect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', 1046, t, 0.1, 0.2);
  }

  waveStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 98, t, 0.6, 0.3);
    this.osc('sawtooth', 147, t + 0.35, 0.8, 0.3);
    this.osc('sine', 49, t, 1.1, 0.4);
  }

  bossSting() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [55, 55.8, 82.4, 110].forEach((f) => this.osc('sawtooth', f, t, 2.4, 0.2));
    this.osc('sine', 36, t, 2.8, 0.5);
    this.burst(t, 1.8, 0.12, 250, 0.4);
  }

  gameOver() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 220, t, 2.2, 0.3, undefined, 40);
    this.osc('sine', 110, t, 2.6, 0.4, undefined, 25);
    this.burst(t, 2.0, 0.3, 400, 0.4);
  }

  heal() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 523, t, 0.12, 0.2);
    this.osc('sine', 784, t + 0.1, 0.2, 0.2);
  }

  // ---------- ambient bed: gray wind + low drone ----------
  startDrone() {
    if (!this.ctx || this.droneOn) return;
    this.droneOn = true;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(f.frequency);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start();
    lfo.start();
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 41;
    const dg = ctx.createGain();
    dg.gain.value = 0.06;
    drone.connect(dg).connect(this.musicBus);
    drone.start();
    this.droneNodes = [src, lfo, drone, g, dg];
  }

  stopDrone() {
    if (!this.droneOn) return;
    this.droneOn = false;
    for (const n of this.droneNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* ignore */ }
      n.disconnect();
    }
    this.droneNodes = [];
  }
}

export const audio = new AudioEngine();
