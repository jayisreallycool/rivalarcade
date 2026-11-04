import { useSyncExternalStore } from 'react';

// Web Audio API Retro Arcade Synthesizer
// Provides zero-latency, zero-asset-failure procedural arcade sounds

class ArcadeAudioEngine {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  constructor() {
    // Initialized on first user interaction
    // Storage can throw (sandboxed iframes, privacy modes) — never let that crash the app.
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem('rival_audio_enabled');
        if (saved !== null) this.enabled = saved === 'true';
      } catch {
        /* storage unavailable: keep default */
      }
    }
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        if (AudioCtx) this.ctx = new AudioCtx();
      } catch {
        this.ctx = null; // audio unavailable (iOS limits, privacy modes): play silently
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private listeners = new Set<() => void>();

  public subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call from a tap: phones only allow audio to start inside a user gesture. */
  public unlock() {
    if (this.enabled) this.initCtx();
  }

  public setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.haltMusic(0.15);
    else if (this.music.want) this.runMusic();
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('rival_audio_enabled', String(on));
      } catch {
        /* storage unavailable */
      }
    }
    this.listeners.forEach((fn) => fn());
  }

  /** Flips sound on/off. Returns true when sound is now MUTED. */
  public toggleMute(): boolean {
    this.setEnabled(!this.enabled);
    return !this.enabled;
  }

  // Quick button tap
  public playTap() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  // Jump swoosh
  public playJump() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(580, t + 0.15);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.15);
  }

  // Laser or dash
  public playLaser() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.12);

    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.12);
  }

  // Basketball swish or net score
  public playSwish() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    // White noise burst for net swoosh + high chime
    const bufferSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;

    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);

    // Chime
    const osc = this.ctx.createOscillator();
    const chimeGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.2);
    chimeGain.gain.setValueAtTime(0.1, t + 0.05);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(chimeGain);
    chimeGain.connect(this.ctx.destination);
    osc.start(t + 0.05);
    osc.stop(t + 0.2);
  }

  // Gem / coin score pickup
  public playScore(pitchMultiplier: number = 1) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.type = 'sine';
    const baseFreq = 523.25 * pitchMultiplier; // C5
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + 0.1);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  // Combo burst
  public playCombo(comboCount: number) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const pitches = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    const freq = pitches[Math.min(comboCount - 1, pitches.length - 1)] || 1046.5;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.setValueAtTime(freq * 1.25, t + 0.08);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  // Powerup / level up fanfare
  public playPowerup() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const notes = [440, 554.37, 659.25, 880];
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const noteTime = t + idx * 0.06;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.1, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.15);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.15);
    });
  }

  // Victory fanfare
  public playWin() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const melody = [
      { f: 523.25, d: 0.12 },
      { f: 659.25, d: 0.12 },
      { f: 783.99, d: 0.12 },
      { f: 1046.5, d: 0.35 },
    ];
    let curTime = this.ctx.currentTime;

    melody.forEach((note) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, curTime);

      gain.gain.setValueAtTime(0.15, curTime);
      gain.gain.exponentialRampToValueAtTime(0.001, curTime + note.d);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(curTime);
      osc.stop(curTime + note.d);

      curTime += note.d * 0.85;
    });
  }

  // Defeat / Game over sound
  public playLose() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const notes = [440, 392, 349.23, 293.66];
    let curTime = this.ctx.currentTime;

    notes.forEach((freq) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, curTime);

      gain.gain.setValueAtTime(0.12, curTime);
      gain.gain.exponentialRampToValueAtTime(0.001, curTime + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(curTime);
      osc.stop(curTime + 0.18);

      curTime += 0.14;
    });
  }

  // ------------------------------------------------------------------ background music
  // An original synthwave loop, synthesized live (no audio files): pad + bass + drums + arpeggio.
  // Layers fade in as `intensity` rises (0 calm → 1 full), so the track builds with the game.
  private music = {
    want: false,
    timer: null as ReturnType<typeof setInterval> | null,
    gain: null as GainNode | null,
    step: 0,
    next: 0,
    intensity: 0.2,
    bound: false,
  };
  private noise: AudioBuffer | null = null;

  /** Start (or keep playing) the background loop. Call from a tap or right after one. */
  public startMusic(intensity = 0.2) {
    this.music.want = true;
    this.music.intensity = intensity;
    if (typeof document !== 'undefined' && !this.music.bound) {
      this.music.bound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.haltMusic(0.05);
        else if (this.music.want) this.runMusic();
      });
    }
    this.runMusic();
  }

  public stopMusic(fade = 0.8) {
    this.music.want = false;
    this.haltMusic(fade);
  }

  public setMusicIntensity(v: number) {
    this.music.intensity = Math.max(0, Math.min(1, v));
  }

  public get musicPlaying() {
    return Boolean(this.music.timer);
  }

  private runMusic() {
    if (!this.enabled || this.music.timer) return;
    this.initCtx();
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.2);
    gain.connect(ctx.destination);
    this.music.gain = gain;
    this.music.step = 0;
    this.music.next = ctx.currentTime + 0.1;
    // Look-ahead scheduler: a cheap timer queues notes ~150 ms ahead on the audio clock.
    this.music.timer = setInterval(() => this.scheduleMusic(), 30);
  }

  private haltMusic(fade: number) {
    const m = this.music;
    if (m.timer) clearInterval(m.timer);
    m.timer = null;
    const g = m.gain;
    m.gain = null;
    if (g && this.ctx) {
      const t = this.ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      } catch {
        /* ignore */
      }
      setTimeout(() => g.disconnect(), (fade + 0.3) * 1000);
    }
  }

  private static readonly TEMPO = 112;
  // Am – F – C – G, one bar each (MIDI notes).
  private static readonly CHORDS = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ];
  private static readonly ARP = [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 3, 2, 1, 2];

  private scheduleMusic() {
    const ctx = this.ctx;
    const out = this.music.gain;
    if (!ctx || !out) return;
    const stepDur = 60 / ArcadeAudioEngine.TEMPO / 4;
    // After a long stall (tab throttled) skip ahead rather than playing a burst of notes.
    if (this.music.next < ctx.currentTime - 0.2) this.music.next = ctx.currentTime + 0.05;
    while (this.music.next < ctx.currentTime + 0.15) {
      this.playMusicStep(this.music.step, this.music.next, stepDur, out);
      this.music.next += stepDur;
      this.music.step = (this.music.step + 1) % 64;
    }
  }

  private playMusicStep(step: number, t: number, sd: number, out: GainNode) {
    const lvl = this.music.intensity;
    const s16 = step % 16;
    const chord = ArcadeAudioEngine.CHORDS[Math.floor(step / 16)];
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

    // Pad: soft sustained chord each bar.
    if (s16 === 0) chord.forEach((n) => this.tone(out, 'triangle', hz(n), t, sd * 16, 0.045, 900, 0.35));
    // Bass: eighth notes, octave bounce.
    if (s16 % 2 === 0) this.tone(out, 'sawtooth', hz(chord[0] - 24 + (s16 % 8 === 6 ? 12 : 0)), t, sd * 1.6, 0.16, 520 + lvl * 500, 0.005);
    // Hats on the off-beats; 16ths once it heats up.
    if (s16 % 4 === 2 || (lvl > 0.75 && s16 % 2 === 1)) this.drum(out, 'hat', t, s16 % 4 === 2 ? 0.09 : 0.04);
    // Kick: four on the floor from intensity 0.35.
    if (lvl > 0.35 && s16 % 4 === 0) this.drum(out, 'kick', t, 0.75);
    else if (s16 === 0) this.drum(out, 'kick', t, 0.55);
    // Snare on 2 and 4 from intensity 0.6.
    if (lvl > 0.6 && (s16 === 4 || s16 === 12)) this.drum(out, 'snare', t, 0.28);
    // Arpeggio from intensity 0.5, an octave higher doubling near the top.
    if (lvl > 0.5) {
      const idx = ArcadeAudioEngine.ARP[s16];
      const n = idx < 3 ? chord[idx] + 12 : chord[0] + 24;
      this.tone(out, 'square', hz(n), t, sd * 0.9, 0.035, 2200, 0.004);
      if (lvl > 0.85 && s16 % 2 === 0) this.tone(out, 'square', hz(n + 12), t, sd * 0.7, 0.018, 3200, 0.004);
    }
  }

  private tone(out: AudioNode, type: OscillatorType, freq: number, t: number, dur: number, vol: number, cutoff: number, attack: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private drum(out: AudioNode, kind: 'kick' | 'hat' | 'snare', t: number, vol: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(out);
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.25);
      return;
    }
    if (!this.noise) {
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const dur = kind === 'hat' ? 0.045 : 0.16;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    src.start(t, Math.random() * 0.8, dur + 0.02);
  }
}

export const sound = new ArcadeAudioEngine();

/** Live muted state shared by every mute button (header, games, settings). */
export function useMuted(): boolean {
  return useSyncExternalStore(
    (cb) => sound.subscribe(cb),
    () => !sound.enabled,
    () => false,
  );
}
