// hud.js — DOM HUD: health, cash, wanted stars, clock, objective, banners.
// All blinking and pulsing is keyed to sim time passed into update().
// The HUD never reads a wall clock; the clock shown is the in-game clock.

import { fmtClock } from './config.js';

export class HUD {
  constructor(state) {
    this.state = state;
    this.el = {
      health: document.getElementById('hud-health'),
      healthBar: document.getElementById('hud-health-bar'),
      cash: document.getElementById('hud-cash'),
      stars: document.getElementById('hud-stars'),
      clock: document.getElementById('hud-clock'),
      objective: document.getElementById('hud-objective'),
      speed: document.getElementById('hud-speed'),
      flash: document.getElementById('hud-flash'),
      banner: document.getElementById('hud-banner'),
      ammo: document.getElementById('hud-ammo'),
      tokens: document.getElementById('hud-tokens'),
      damage: document.getElementById('hud-damage'),
      start: document.getElementById('start-screen'),
      pause: document.getElementById('pause-screen'),
      over: document.getElementById('over-screen'),
      overTitle: document.getElementById('over-title'),
      overText: document.getElementById('over-text'),
    };
    this._flashUntilTick = -1;
    this._bannerUntilTick = -1;
  }

  setObjective(text) {
    if (this.el.objective) this.el.objective.textContent = '◆ ' + text;
  }

  flash(text) {
    if (!this.el.flash) return;
    this.el.flash.textContent = text;
    this.el.flash.style.opacity = '1';
    this._flashUntilTick = this.state.sim.tick + 150;
  }

  banner(text) {
    if (!this.el.banner) return;
    this.el.banner.textContent = text;
    this.el.banner.style.opacity = '1';
    this._bannerUntilTick = this.state.sim.tick + 240;
  }

  showStart() {
    if (this.el.start) this.el.start.style.display = 'flex';
  }

  hideStart() {
    if (this.el.start) this.el.start.style.display = 'none';
  }

  showPause(show) {
    if (this.el.pause) this.el.pause.style.display = show ? 'flex' : 'none';
  }

  showOver(title, text) {
    if (this.el.overTitle) this.el.overTitle.textContent = title;
    if (this.el.overText) this.el.overText.textContent = text;
    if (this.el.over) this.el.over.style.display = 'flex';
  }

  hideOver() {
    if (this.el.over) this.el.over.style.display = 'none';
  }

  update(simNow, tick) {
    const st = this.state;
    const p = st.player;
    if (this._flashUntilTick >= 0 && tick > this._flashUntilTick) {
      this.el.flash.style.opacity = '0';
      this._flashUntilTick = -1;
    }
    if (this._bannerUntilTick >= 0 && tick > this._bannerUntilTick) {
      this.el.banner.style.opacity = '0';
      this._bannerUntilTick = -1;
    }
    if (this.el.healthBar) {
      this.el.healthBar.style.width = Math.max(0, p.health) + '%';
      this.el.healthBar.style.background =
        p.health > 50 ? '#2ecc71' : p.health > 25 ? '#f2c14e' : '#d94f3d';
    }
    if (this.el.health) {
      this.el.health.textContent = Math.ceil(Math.max(0, p.health)) + ' HP';
    }
    if (this.el.cash) this.el.cash.textContent = '$' + st.cash;
    if (this.el.clock) this.el.clock.textContent = fmtClock(st.minutes) + ' · Day 1';
    if (this.el.ammo) {
      this.el.ammo.textContent =
        p.weapon === 'pistol'
          ? 'Pistol · ' + p.ammo + ' rounds'
          : 'Fists — press 2 for pistol';
    }
    if (this.el.tokens) {
      this.el.tokens.textContent = '☀ ' + st.tokensCollected.size + '/12';
    }
    if (this.el.speed) {
      if (p.car) {
        // Speed + gear: gear is a pure function of speed, so the readout
        // is deterministic and gives the drive a sense of progression.
        const v = Math.abs(p.car.speed) * 3.6;
        const gear = v < 1 ? 'N' : Math.min(5, Math.floor(v / 24) + 1);
        this.el.speed.textContent = Math.round(v) + ' km/h · Gear ' + gear;
      } else {
        this.el.speed.textContent = 'On foot';
      }
    }
    if (this.el.objective) {
      // Objective tracker: the mission countdown rides on the objective
      // line while a timed mission is running.
      let t = '◆ ' + st.objective;
      if (st.missions && st.missions.timerActive && st.missionTimer > 0) {
        const s = Math.ceil(st.missionTimer);
        t += ' · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      }
      this.el.objective.textContent = t;
    }
    if (this.el.damage) {
      // Damage vignette: red screen edge, tick-based so it is deterministic.
      // A fresh hit flashes hard and fades over 30 ticks; below 30 HP the
      // edge pulses while Mara is hurt.
      let o = 0;
      const age = tick - (st.damageFlashTick || -1);
      if (age >= 0 && age < 30) o = 0.5 * (1 - age / 30);
      if (p.health < 30 && p.health > 0) {
        o = Math.max(o, 0.16 + 0.08 * Math.sin(simNow * 4));
      }
      this.el.damage.style.opacity = String(o);
    }
    if (this.el.stars) {
      // Wanted stars blink when the level is high, on a sim-time square wave.
      const blink = st.wanted >= 4 && Math.floor(simNow * 2) % 2 === 0;
      let s = '';
      for (let i = 0; i < 5; i++) s += i < st.wanted ? '★' : '☆';
      this.el.stars.textContent = s;
      this.el.stars.style.opacity = blink ? '0.35' : '1';
      this.el.stars.style.color = st.wanted > 0 ? '#ffd23f' : '#ffffff88';
    }
  }
}
