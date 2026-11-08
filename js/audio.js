// Broadcast TV Game Show Sound Engine (Web Audio API + Offline Synthesis)
// Supports: ding.mp3, strike.mp3, duplicate.mp3, round_win.mp3, timer_tick.mp3, timer_end.mp3, buzzer.mp3

class BroadcastSoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastPlayed = null;
    this.history = [];
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  play(soundKey) {
    const normalized = String(soundKey).replace(/\.mp3$/i, '');
    const entry = {
      sound: `${normalized}.mp3`,
      timestamp: Date.now()
    };
    this.lastPlayed = entry;
    this.history.push(entry);
    if (this.history.length > 30) this.history.shift();

    window.dispatchEvent(new CustomEvent('sfx-played', { detail: entry }));

    if (this.muted) return entry;

    const ctx = this.ensureContext();
    if (!ctx) return entry;

    try {
      switch (normalized) {
        case 'ding':
          this.synthDing(ctx);
          break;
        case 'strike':
          this.synthStrike(ctx);
          break;
        case 'duplicate':
          this.synthDuplicate(ctx);
          break;
        case 'round_win':
          this.synthRoundWin(ctx);
          break;
        case 'timer_tick':
          this.synthTimerTick(ctx);
          break;
        case 'timer_end':
          this.synthTimerEnd(ctx);
          break;
        case 'buzzer':
          this.synthBuzzer(ctx);
          break;
        default:
          this.synthDing(ctx);
      }
    } catch (e) {
      // Ignore audio autoplay blockage prior to user gesture
    }
    return entry;
  }

  // Classic TV Game Show bright dual-bell chime (ding.mp3)
  synthDing(ctx) {
    const now = ctx.currentTime;
    const freqs = [1046.5, 1318.5, 2093.0]; // C6, E6, C7 harmonic bell
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 2 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, now);

      const peak = idx === 0 ? 0.28 : idx === 1 ? 0.2 : 0.12;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.68);
    });
  }

  // Aggressive studio harsh buzzer for X / Fehlversuch (strike.mp3)
  synthStrike(ctx) {
    const now = ctx.currentTime;
    const baseFreqs = [110, 116.5, 164.8, 220]; // Harsh dissonant saw/square cluster
    baseFreqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.linearRampToValueAtTime(f * 0.96, now + 0.65);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.setValueAtTime(0.18, now + 0.52);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.75);
    });
  }

  // Double-boop warning alert for Finale duplicate answer (duplicate.mp3)
  synthDuplicate(ctx) {
    const now = ctx.currentTime;
    [0, 0.16].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const f = idx === 0 ? 370 : 277.2; // F#4 -> C#4 warning two-tone
      osc.frequency.setValueAtTime(f, now + offset);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(0.24, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.15);
    });
  }

  // Brass-like ascending studio fanfare for round settlement / win (round_win.mp3)
  synthRoundWin(ctx) {
    const now = ctx.currentTime;
    const notes = [
      { f: 523.25, t: 0.0, d: 0.14 },  // C5
      { f: 659.25, t: 0.12, d: 0.14 }, // E5
      { f: 783.99, t: 0.24, d: 0.14 }, // G5
      { f: 1046.5, t: 0.38, d: 0.55 }  // C6
    ];
    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.f, now + n.t);

      gain.gain.setValueAtTime(0.001, now + n.t);
      gain.gain.linearRampToValueAtTime(0.25, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    });
  }

  // Crisp studio clock pulse for Fast Money timer (timer_tick.mp3)
  synthTimerTick(ctx) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // End-of-timer gong/horn (timer_end.mp3)
  synthTimerEnd(ctx) {
    const now = ctx.currentTime;
    [196, 293.66, 392].forEach(f => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.85, now + 0.8);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.88);
    });
  }

  // Face-off podium buzz-in chime (buzzer.mp3)
  synthBuzzer(ctx) {
    const now = ctx.currentTime;
    [880, 1174.66].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, now + idx * 0.07);

      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.07 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.27);
    });
  }
}

export const soundEngine = new BroadcastSoundEngine();
