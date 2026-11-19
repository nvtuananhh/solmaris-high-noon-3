// audio.js — WebAudio synth only. No audio files, no network.
// All timing is driven by the sim clock passed into update(simNow, tick):
// the siren phase, music step and engine pitch read sim time, never a wall
// clock. Randomness (siren wobble phase, music variation) comes from the
// audio stream, drawn once at init in a fixed order. The percussion noise
// buffer is generated from a fixed local seed, so it is identical every run.
// Note: ctx.currentTime is only used to schedule already-decided notes;
// it never feeds game state, so it cannot change a replay.

import { range, makeRng } from './random.js';

export class AudioEngine {
  constructor(rngAudio) {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.engineOsc = null;
    this.engineGain = null;
    this.subOsc = null;
    this.subGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicGain = null;
    this._sirenPhase = rngAudio ? range(rngAudio, 0, Math.PI * 2) : 0;
    this._lastMusicTick = -1;
    this._lastBar = -1;
    this._noiseBuf = null;
    this._muted = false;
    // Bass / lead tables: fixed, so the loop is the same every run.
    this._bassNotes = [55, 55, 65.41, 49, 55, 55, 73.42, 65.41];
    this._leadNotes = [220, 261.63, 329.63, 261.63, 220, 196, 246.94, 293.66];
    this._chords = [
      [130.81, 164.81, 196.0],
      [110.0, 130.81, 164.81],
      [98.0, 123.47, 146.83],
      [87.31, 110.0, 130.81],
    ];
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);

      // Engine: sawtooth through a lowpass, plus a sub-octave second
      // voice an octave down, so the car sounds like an engine, not a buzzer.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      this.engineOsc.connect(lp);
      lp.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();

      this.subOsc = this.ctx.createOscillator();
      this.subOsc.type = 'sawtooth';
      this.subOsc.frequency.value = 27.5;
      this.subGain = this.ctx.createGain();
      this.subGain.gain.value = 0;
      const subLp = this.ctx.createBiquadFilter();
      subLp.type = 'lowpass';
      subLp.frequency.value = 220;
      this.subOsc.connect(subLp);
      subLp.connect(this.subGain);
      this.subGain.connect(this.master);
      this.subOsc.start();

      // Deterministic noise buffer for hats / crash noise (fixed local seed).
      const nrng = makeRng(0xc0ffee);
      const nlen = Math.floor(this.ctx.sampleRate * 0.5);
      const nbuf = this.ctx.createBuffer(1, nlen, this.ctx.sampleRate);
      const nd = nbuf.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = nrng() * 2 - 1;
      this._noiseBuf = nbuf;

      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.1;
      this.musicGain.connect(this.master);
    } catch (_) {
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.ctx) {
      this.master.gain.value = this._muted ? 0 : v;
    }
  }

  setMuted(m) {
    this._muted = m;
    if (this.master && this.ctx) {
      this.master.gain.value = m ? 0 : this.volume;
    }
  }

  _tone(freq, dur, type, gain, dest, t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // One music note per 15 sim ticks (4 notes/sec at 60 ticks/sec): bass +
  // lead picked from fixed tables by step index — fully deterministic.
  _musicNote(step) {
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime + 0.02;
    const bass = this._bassNotes[step % this._bassNotes.length];
    const lead = this._leadNotes[(step * 3 + 1) % this._leadNotes.length];
    this._tone(bass, 0.24, 'triangle', 0.5, this.musicGain, t);
    if (step % 2 === 0) this._tone(lead, 0.18, 'square', 0.1, this.musicGain, t);
    // Percussion: kick on the beat, hat off it — the loop finally grooves.
    if (step % 4 === 0) this._kick(t);
    if (step % 2 === 1) this._hat(t);
  }

  _kick(t) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  _hat(t) {
    if (!this.ctx || !this._noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, 0.1);
    src.stop(t + 0.05);
  }

  // One soft pad chord per 32-step bar, from a fixed chord table.
  _padChord(bar) {
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime + 0.02;
    const chord = this._chords[bar % this._chords.length];
    for (const freq of chord) {
      this._tone(freq, 1.9, 'triangle', 0.045, this.musicGain, t);
    }
  }

  // Rising four-note sting: mission starts and wanted-level jumps.
  sting() {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this._tone(f, 0.16, 'square', 0.09, this.master, t + i * 0.09);
      });
    } catch (_) {
      // Audio is best-effort.
    }
  }

  // Low thud for crashes and rams: sine drop + a burst of noise.
  thud() {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(100, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.18);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.22);
      if (this._noiseBuf) {
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 400;
        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(0.25, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        src.connect(f);
        f.connect(ng);
        ng.connect(this.master);
        src.start(t, 0.2);
        src.stop(t + 0.13);
      }
    } catch (_) {
      // Audio is best-effort.
    }
  }

  update(simNow, tick, speed, wanted) {
    if (!this.ctx) return;
    const engineTarget = speed > 0.2 ? 0.05 + Math.min(0.1, speed * 0.003) : 0.0;
    if (this.engineGain) this.engineGain.gain.value = engineTarget;
    if (this.engineOsc) this.engineOsc.frequency.value = 55 + speed * 3.2;
    if (this.subOsc) this.subOsc.frequency.value = (55 + speed * 3.2) / 2;
    if (this.subGain) this.subGain.gain.value = engineTarget * 0.6;
    // Siren: two-tone wobble keyed to sim time, fixed phase from init.
    const phase = simNow * 2.4 + this._sirenPhase;
    const tone = Math.sin(phase) > 0 ? 715 : 932;
    if (this.sirenOsc) this.sirenOsc.frequency.value = tone;
    if (this.sirenGain) this.sirenGain.gain.value = wanted > 0 ? 0.045 : 0;
    const step = Math.floor(tick / 15);
    if (step !== this._lastMusicTick) {
      this._lastMusicTick = step;
      this._musicNote(step);
    }
    const bar = Math.floor(step / 32);
    if (bar !== this._lastBar) {
      this._lastBar = bar;
      this._padChord(bar);
    }
  }

  gunshot() {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * 0.12);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        d[i] = (i / len < 0.2 ? 1 : 1 - i / len) * (i % 2 === 0 ? 0.8 : -0.8);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.35;
      src.connect(g);
      g.connect(this.master);
      src.start(t);
    } catch (_) {
      // Audio is best-effort.
    }
  }

  punch() {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.12);
    } catch (_) {
      // Audio is best-effort.
    }
  }

  chime() {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.18, t + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.3);
        o.connect(g);
        g.connect(this.master);
        o.start(t + i * 0.09);
        o.stop(t + i * 0.09 + 0.32);
      });
    } catch (_) {
      // Audio is best-effort.
    }
  }

  honk() {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.value = 370;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.2);
    } catch (_) {
      // Audio is best-effort.
    }
  }
}
