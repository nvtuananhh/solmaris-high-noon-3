// combat.js — melee + pistol, rivals, health/ammo pickups.
// Damage spread and rival spawn jitter draw from the combat stream.
// Cooldowns are sim-time comparisons (lastShotT in sim seconds).

import { range, pick } from './random.js';
import { dist2d, clamp } from './config.js';
import { buildPersonMesh } from './pedestrians.js';

const RIVAL_SKINS = [0xe8b88a, 0xc98d64];

export class Combat {
  constructor(scene, rngCombat) {
    this.scene = scene;
    this.rng = rngCombat;
    this.rivals = [];
    this.pickups = [];
    this.lastShotT = -10;
    this.lastMeleeT = -10;
  }

  spawnRival(x, z) {
    const mesh = buildPersonMesh(0x5a2a8a, pick(this.rng, RIVAL_SKINS), 0x222222);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const r = {
      mesh,
      pos: mesh.position,
      health: 70,
      heading: 0,
      speed: range(this.rng, 3.2, 4.2),
      attackT: 0,
      id: 600 + this.rivals.length,
    };
    this.rivals.push(r);
    return r;
  }

  spawnPickup(x, z, kind) {
    const color = kind === 'health' ? 0x2ecc71 : 0xf2c14e;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.set(x, 0.9, z);
    this.scene.add(mesh);
    const pk = {
      mesh,
      x,
      z,
      kind,
      id: 700 + this.pickups.length,
      bobPhase: range(this.rng, 0, Math.PI * 2),
    };
    this.pickups.push(pk);
    return pk;
  }

  // Player fires the pistol toward the player heading. Hits the nearest
  // rival inside a narrow cone in range; damage rolls from the combat stream.
  shoot(state, simNow) {
    const p = state.player;
    if (p.weapon !== 'pistol') return 'no-weapon';
    if (p.ammo <= 0) {
      state.flash('No ammo — find a yellow pickup');
      return 'no-ammo';
    }
    if (simNow - this.lastShotT < 0.28) return 'cooldown';
    this.lastShotT = simNow;
    p.ammo -= 1;
    state.audio.gunshot();
    const mx = p.pos.x + Math.sin(p.heading) * 1.2;
    const mz = p.pos.z + Math.cos(p.heading) * 1.2;
    state.fx.muzzle(mx, 1.5, mz);
    state.peds.scare(p.pos.x, p.pos.z, 40);
    let best = null;
    let bestScore = 1e9;
    for (const r of this.rivals) {
      const d = dist2d(p.pos.x, p.pos.z, r.pos.x, r.pos.z);
      if (d > 46) continue;
      const ang = Math.atan2(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
      let dh = ang - p.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      if (Math.abs(dh) > 0.22) continue;
      const score = d + Math.abs(dh) * 20;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) return 'miss';
    const dmg = 34 + range(this.rng, -6, 10);
    best.health -= dmg;
    state.fx.impact(best.pos.x, 1.4, best.pos.z);
    if (best.health > 0) return 'hit';
    state.fx.burst(best.pos.x, 1.2, best.pos.z, 0x8a5a9e, 14, 5);
    this.scene.remove(best.mesh);
    this.rivals.splice(this.rivals.indexOf(best), 1);
    state.kills += 1;
    state.cash += 25;
    state.flash('Rival down — +$25');
    if (state.police) state.police.addHeat(8, simNow);
    return 'kill';
  }

  punch(state, simNow) {
    const p = state.player;
    if (simNow - this.lastMeleeT < 0.45) return 'cooldown';
    this.lastMeleeT = simNow;
    state.audio.punch();
    let hit = false;
    for (const r of this.rivals.slice()) {
      if (dist2d(p.pos.x, p.pos.z, r.pos.x, r.pos.z) < 2.2) {
        r.health -= 14;
        state.fx.impact(r.pos.x, 1.3, r.pos.z);
        hit = true;
        if (r.health <= 0) {
          this.scene.remove(r.mesh);
          this.rivals.splice(this.rivals.indexOf(r), 1);
          state.kills += 1;
          state.cash += 25;
        }
      }
    }
    // Punching a nearby pedestrian is a crime, too.
    const ped = state.peds.nearest(p.pos.x, p.pos.z, 2.2);
    if (ped) {
      state.peds.scare(p.pos.x, p.pos.z, 30);
      if (state.police) state.police.addHeat(10, simNow);
    }
    return hit ? 'hit' : 'miss';
  }

  update(dt, simNow, state) {
    const p = state.player;
    for (const r of this.rivals.slice()) {
      const d = dist2d(p.pos.x, p.pos.z, r.pos.x, r.pos.z);
      r.heading = Math.atan2(p.pos.x - r.pos.x, p.pos.z - r.pos.z);
      if (d > 1.8) {
        r.pos.x += Math.sin(r.heading) * r.speed * dt;
        r.pos.z += Math.cos(r.heading) * r.speed * dt;
      } else {
        r.attackT -= dt;
        if (r.attackT <= 0) {
          r.attackT = 1.1;
          p.damage(9, 'rival crew');
          state.fx.impact(p.pos.x, 1.4, p.pos.z);
        }
      }
      r.mesh.rotation.y = r.heading;
      const swing = Math.sin(simNow * 9 + r.id) * 0.45;
      r.mesh.userData.legL.rotation.x = swing;
      r.mesh.userData.legR.rotation.x = -swing;
    }
    // Pickups bob on sim time; collect on touch.
    for (const pk of this.pickups.slice()) {
      pk.mesh.position.y = 0.9 + Math.sin(simNow * 2.4 + pk.bobPhase) * 0.18;
      pk.mesh.rotation.y += dt * 1.5;
      if (dist2d(p.pos.x, p.pos.z, pk.x, pk.z) < 1.6) {
        if (pk.kind === 'health') {
          p.health = clamp(p.health + 40, 0, 100);
          state.flash('Health +40');
        } else {
          p.ammo += 12;
          state.flash('Ammo +12');
        }
        state.audio.chime();
        this.scene.remove(pk.mesh);
        this.pickups.splice(this.pickups.indexOf(pk), 1);
      }
    }
  }
}
