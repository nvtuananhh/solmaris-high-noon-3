// missions.js — the 5-mission story chain + side activities.
// 1 First Fare (tutorial drive) · 2 Repo Run (steal the sports car, lose a
// 2-star tail) · 3 The Drop (timed delivery, rival ambush) · 4 Heat Wave
// (escape a 4-star dragnet) · 5 High Noon (finale drive to the lighthouse).
// Side: taxi fares, 3 checkpoint races, 12 sun tokens, respray garage.
// The marker bob reads sim time; fare and race IDs come from the state's
// monotonic counter — never from a wall clock.
//
// Timer safety (learned the hard way): a timed mission's fail-retry branch
// may only fire while that mission is actually running. completeMission()
// zeroes the timer and clears timerActive, and the retry branch is guarded
// by a same-tick `done` flag, so a mission that completes on the deadline
// tick can never instantly restart itself.

import { dist2d } from './config.js';
import { range } from './random.js';

export const MISSION_DEFS = [
  {
    name: 'First Fare',
    brief: 'Pick up Dario at the Old Town square, then drive him to the Marina.',
  },
  {
    name: 'Repo Run',
    brief: 'Repossess the red sports car from the guarded marina lot, then lose the 2-star tail.',
  },
  {
    name: 'The Drop',
    brief: 'Deliver the package across town in time. Rival crew will try to stop you.',
  },
  {
    name: 'Heat Wave',
    brief: 'A 4-star dragnet is closing in. Survive it and reach the safehouse.',
  },
  {
    name: 'High Noon',
    brief: 'Drive the fixer to the lighthouse at noon, police and rivals in pursuit.',
  },
];

const MISSION_PAY = [250, 400, 500, 650, 1000];

export class Missions {
  constructor(state) {
    this.state = state;
    this.rng = state.streams.missions;
    this.markerMesh = null;
    this.markerBaseY = 2.2;
    this.activeFare = null;
    this.race = null;
    // True only while a timed mission (The Drop, Heat Wave) is actually
    // running. The HUD countdown and the fail-retry branches read this, so
    // a leftover timer from a finished mission can never fake a timeout.
    this.timerActive = false;
    this._buildMarker();
  }

  _buildMarker() {
    const geo = new THREE.CylinderGeometry(0.12, 0.12, 5, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.65,
    });
    this.markerMesh = new THREE.Mesh(geo, mat);
    this.markerMesh.visible = false;
    this.state.scene.add(this.markerMesh);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.2, 0.22, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    this.markerMesh.add(ring);
  }

  setObjective(text) {
    this.state.objective = text;
    this.state.hud.setObjective(text);
  }

  setMarker(x, z) {
    this.state.marker = { x, z };
    this.markerMesh.position.set(x, this.markerBaseY, z);
    this.markerMesh.visible = true;
  }

  clearMarker() {
    this.state.marker = null;
    this.markerMesh.visible = false;
  }

  // Re-arm the marker/objective after a load, from missionIndex only.
  syncFromState() {
    const st = this.state;
    if (st.missionIndex >= MISSION_DEFS.length) {
      this.setObjective('Story complete — free roam. Press M for a fare, R for a race.');
      this.clearMarker();
      return;
    }
    this.startMission(st.missionIndex, true);
  }

  startMission(i, silent) {
    const st = this.state;
    const def = MISSION_DEFS[i];
    if (!def) return;
    st.missionIndex = i;
    st.missionStage = 0;
    st.missionTimer = 0;
    this.timerActive = i === 2 || i === 3;
    if (!silent) {
      st.banner('MISSION: ' + def.name);
      st.audio.sting();
    }
    if (i === 0) {
      this.setObjective('First Fare: meet Dario at the Old Town square');
      this.setMarker(10, 8);
    } else if (i === 1) {
      this.setObjective('Repo Run: take the red sports car at the marina lot (150, 150)');
      this.setMarker(150, 150);
    } else if (i === 2) {
      this.setObjective('The Drop: pick up the package at the depot (0, -180)');
      this.setMarker(0, -180);
      st.missionTimer = 150;
    } else if (i === 3) {
      this.setObjective('Heat Wave: survive the dragnet — reach the safehouse (-150, 30)');
      this.setMarker(-150, 30);
      st.police.addHeat(60, st.sim.now);
      st.missionTimer = 120;
    } else if (i === 4) {
      this.setObjective('High Noon: drive the fixer to the lighthouse (-198, -228)');
      this.setMarker(-198, -228);
      st.police.addHeat(45, st.sim.now);
      st.combat.spawnRival(st.player.pos.x + 14, st.player.pos.z - 10);
      st.combat.spawnRival(st.player.pos.x - 12, st.player.pos.z - 14);
    }
  }

  completeMission() {
    const st = this.state;
    const idx = st.missionIndex;
    const pay = MISSION_PAY[idx] || 250;
    st.cash += pay;
    st.missionsDone.push(idx);
    st.banner('MISSION COMPLETE — ' + MISSION_DEFS[idx].name + '  +$' + pay);
    st.audio.chime();
    st.missionTimer = 0;
    this.timerActive = false;
    st.police.coolOff(60);
    this.clearMarker();
    st.missionIndex = idx + 1;
    st.missionStage = 0;
    if (st.missionIndex < MISSION_DEFS.length) {
      this.setObjective(
        'Mission complete! Press M to start: ' + MISSION_DEFS[st.missionIndex].name,
      );
    } else {
      this.setObjective('Story complete — free roam. Press M for a fare, R for a race.');
    }
  }

  startFare() {
    const st = this.state;
    if (this.activeFare) return;
    const id = st.nextId++;
    const spots = [
      [-60, 60], [120, 60], [-120, -60], [60, 120],
      [-180, 120], [180, -120], [0, 120], [-60, -120],
    ];
    const a = spots[Math.floor(this.rng() * spots.length)];
    const b = spots[Math.floor(this.rng() * spots.length)];
    this.activeFare = {
      id,
      pickup: { x: a[0], z: a[1] },
      dropoff: { x: b[0], z: b[1] },
      stage: 0,
      pay: Math.round(range(this.rng, 45, 140)),
    };
    this.setObjective('Taxi fare #' + id + ': pick up the passenger');
    this.setMarker(a[0], a[1]);
    st.banner('New fare — pick up the passenger');
  }

  startRace() {
    const st = this.state;
    if (this.race) return;
    const id = st.nextId++;
    const sets = [
      [[-120, 180], [0, 180], [120, 180], [180, 60]],
      [[-198, 120], [-198, 0], [-198, -120], [-198, -228]],
      [[-60, -60], [60, -60], [120, 0], [150, 150]],
    ];
    const cps = sets[Math.floor(this.rng() * sets.length)];
    this.race = { id, checkpoints: cps, next: 0, timer: 150 };
    this.setObjective('Street race #' + id + ': hit the checkpoints in order');
    this.setMarker(cps[0][0], cps[0][1]);
    st.banner('Race started — 4 checkpoints, 150 seconds');
  }

  update(dt, simNow) {
    const st = this.state;
    const p = st.player;
    // Marker bob: pure function of sim time.
    if (this.markerMesh.visible) {
      this.markerMesh.position.y = this.markerBaseY + Math.sin(simNow * 2.2) * 0.5;
      this.markerMesh.rotation.y += dt * 0.8;
    }
    // Sun tokens.
    for (const t of st.city.tokens) {
      if (t.taken || st.tokensCollected.has(t.id)) {
        t.mesh.visible = false;
        continue;
      }
      t.mesh.rotation.y += dt * 1.2;
      t.mesh.position.y = 1.6 + Math.sin(simNow * 2 + t.id) * 0.25;
      if (dist2d(p.pos.x, p.pos.z, t.x, t.z) < 2.2) {
        t.taken = true;
        t.mesh.visible = false;
        st.tokensCollected.add(t.id);
        st.cash += 30;
        st.fx.tokenSparkle(t.x, 1.6, t.z);
        st.audio.chime();
        st.flash('Sun token ' + st.tokensCollected.size + '/12 — +$30');
        if (st.tokensCollected.size >= 12) st.banner('All 12 sun tokens collected!');
      }
    }
    // Respray garage cools wanted heat when the player drives inside.
    if (dist2d(p.pos.x, p.pos.z, 60, -120) < 9 && st.wanted > 0) {
      st.police.coolOff(dt * 30);
      if (st.wanted === 0) st.flash('Fresh Coat — heat is off, you are clean');
    }
    // Fare flow.
    if (this.activeFare) {
      const f = this.activeFare;
      const target = f.stage === 0 ? f.pickup : f.dropoff;
      if (dist2d(p.pos.x, p.pos.z, target.x, target.z) < 5) {
        if (f.stage === 0) {
          f.stage = 1;
          this.setObjective('Taxi fare #' + f.id + ': drop off the passenger');
          this.setMarker(f.dropoff.x, f.dropoff.z);
          st.flash('Passenger aboard — drive to the marker');
        } else {
          st.cash += f.pay;
          st.faresDone += 1;
          st.banner('Fare complete — +$' + f.pay);
          st.audio.chime();
          this.activeFare = null;
          this.clearMarker();
          this.setObjective('Free roam — press M for a mission, F for a fare, R for a race');
        }
      }
    }
    // Race flow.
    if (this.race) {
      const r = this.race;
      r.timer -= dt;
      const cp = r.checkpoints[r.next];
      if (cp && dist2d(p.pos.x, p.pos.z, cp[0], cp[1]) < 7) {
        r.next += 1;
        st.audio.chime();
        if (r.next >= r.checkpoints.length) {
          st.cash += 300;
          st.racesWon += 1;
          st.banner('Race won — +$300');
          this.race = null;
          this.clearMarker();
          this.setObjective('Free roam — press M for a mission, F for a fare, R for a race');
        } else {
          const n = r.checkpoints[r.next];
          this.setMarker(n[0], n[1]);
          st.flash('Checkpoint ' + (r.next + 1) + '/4');
        }
      }
      if (r.timer <= 0) {
        st.flash('Race failed — out of time');
        this.race = null;
        this.clearMarker();
      }
    }
    // Mission flow.
    if (st.missionIndex >= MISSION_DEFS.length) return;
    const i = st.missionIndex;
    const at = (x, z, r) => dist2d(p.pos.x, p.pos.z, x, z) < r;
    if (i === 0) {
      if (st.missionStage === 0 && at(10, 8, 5)) {
        st.missionStage = 1;
        this.setObjective('First Fare: Dario is aboard — drive him to the Marina (150, 150)');
        this.setMarker(150, 150);
        st.flash('Dario: "Easy now — the marina, and mind the paint."');
      } else if (st.missionStage === 1 && at(150, 150, 7)) {
        this.completeMission();
      }
    } else if (i === 1) {
      if (st.missionStage === 0 && p.car && p.car.kind === 'sport' && at(150, 150, 12)) {
        st.missionStage = 1;
        st.police.addHeat(22, simNow);
        this.setObjective('Repo Run: you have the car — lose the 2-star tail, then reach the garage (60, -120)');
        this.setMarker(60, -120);
        st.flash('Lot guard: "Hey! That car is not yours!"');
      } else if (st.missionStage === 1 && st.wanted === 0 && at(60, -120, 9)) {
        this.completeMission();
      }
    } else if (i === 2) {
      st.missionTimer -= dt;
      let done = false;
      if (st.missionStage === 0 && at(0, -180, 5)) {
        st.missionStage = 1;
        this.setObjective('The Drop: package aboard — deliver to the Marina (150, 150). Rivals incoming!');
        this.setMarker(150, 150);
        st.combat.spawnRival(8, -170);
        st.combat.spawnRival(-10, -168);
        st.combat.spawnRival(0, -196);
        st.police.addHeat(14, simNow);
      } else if (st.missionStage === 1 && at(150, 150, 7)) {
        this.completeMission();
        done = true;
      }
      // The retry must not fire on the tick the mission completes:
      // completeMission zeroes the timer, and a bare timer check here
      // would instantly restart a finished job.
      if (!done && this.timerActive && st.missionTimer <= 0 && st.missionStage < 2) {
        st.flash('The Drop failed — out of time. Press M to retry.');
        st.missionIndex = 2;
        st.missionStage = 0;
        this.startMission(2, true);
      }
    } else if (i === 3) {
      st.missionTimer -= dt;
      if (at(-150, 30, 8) && st.wanted <= 1) {
        this.completeMission();
      } else if (this.timerActive && st.missionTimer <= 0) {
        st.flash('Heat Wave failed — the dragnet caught up. Press M to retry.');
        this.startMission(3, true);
      }
    } else if (i === 4) {
      if (at(-198, -228, 10)) {
        this.completeMission();
        st.banner('HIGH NOON — Solmaris is yours, Mara. Story complete!');
      }
    }
  }
}
