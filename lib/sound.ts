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

  public setEnabled(on: boolean) {
    this.enabled = on;
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
