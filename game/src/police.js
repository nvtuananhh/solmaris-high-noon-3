// police.js — wanted 1–5 stars, police cars + foot officers that chase,
// ram, and arrest. All timers are sim time (lastCrimeT in sim seconds);
// the light-bar flicker and siren wobble read sim time. Spawn jitter draws
// from the police stream, in fixed order per spawn.

import { Car } from './vehicles.js';
import { range } from './random.js';
import { clamp, dist2d } from './config.js';
import { buildPersonMesh } from './pedestrians.js';

function heatToLevel(heat) {
  if (heat < 12) return 1;
  if (heat < 30) return 2;
  if (heat < 55) return 3;
  if (heat < 80) return 4;
  return 5;
}

export class Police {
  constructor(scene, city, rngPolice) {
    this.scene = scene;
    this.city = city;
    this.rng = rngPolice;
    this.cars = [];
    this.officers = [];
    this.wanted = 0;
    this.lastCrimeT = 0;
    this.lastSeenT = 0;
    this.heat = 0;
    this.bustedHoldT = 0;
    this._simNow = 0;
  }

  setWanted(level, reason) {
    const prev = this.wanted;
    this.wanted = clamp(Math.round(level), 0, 5);
    if (this.wanted > 0) this.lastCrimeT = this._simNow || 0;
    return prev !== this.wanted;
  }

  addHeat(amount, simNow) {
    this.heat = Math.min(100, this.heat + amount);
    this.lastCrimeT = simNow;
    const level = heatToLevel(this.heat);
    if (level > this.wanted) this.setWanted(level, 'heat');
  }

  coolOff(amount) {
    this.heat = Math.max(0, this.heat - amount);
    if (this.heat < 8 && this.wanted > 0) this.setWanted(0, 'cooled');
  }

  _spawnCarNear(player) {
    const rng = this.rng;
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 34, 55);
    const x = clamp(player.pos.x + Math.cos(a) * d, -230, 230);
    const z = clamp(player.pos.z + Math.sin(a) * d, -230, 230);
    const car = new Car(this.scene, x, z, range(rng, 0, Math.PI * 2), 0x1a1a2e, 'sedan', {
      driver: 'police',
      id: 400 + this.cars.length,
    });
    car.isPolice = true;
    car.spec = { accel: 19, maxSpeed: 36, len: 4.4, wid: 1.9 };
    // Police livery: white doors + a red/blue light bar.
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.92, 0.2, 3.2),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    stripe.position.y = 0.98;
    car.mesh.add(stripe);
    const barR = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    barR.position.set(-0.45, 1.62, 0);
    car.mesh.add(barR);
    const barB = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2255ff }),
    );
    barB.position.set(0.45, 1.62, 0);
    car.mesh.add(barB);
    car._barR = barR;
    car._barB = barB;
    this.cars.push(car);
    return car;
  }

  _spawnOfficerNear(player) {
    const rng = this.rng;
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 18, 30);
    const mesh = buildPersonMesh(0x1a2a4a, 0xe8b88a, 0x1a2a4a);
    const x = clamp(player.pos.x + Math.cos(a) * d, -230, 230);
    const z = clamp(player.pos.z + Math.sin(a) * d, -230, 230);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const off = {
      mesh,
      pos: mesh.position,
      heading: 0,
      speed: 4.6,
      id: 500 + this.officers.length,
    };
    this.officers.push(off);
    return off;
  }

  update(dt, simNow, state) {
    this._simNow = simNow;
    const p = state.player;
    if (this.wanted > 0) {
      this.lastSeenT = simNow;
      // Spawn budget: one unit per wanted star, plus one extra at 3+.
      const want = this.wanted <= 2 ? this.wanted : this.wanted + 1;
      while (this.cars.length < want) this._spawnCarNear(p);
      if (this.wanted >= 3) {
        while (this.officers.length < this.wanted - 1) this._spawnOfficerNear(p);
      }
    }
    // Chase cars: steer at the player, ram speed, light-bar flicker on sim time.
    for (const car of this.cars) {
      const d = dist2d(car.pos.x, car.pos.z, p.pos.x, p.pos.z);
      const target = Math.atan2(p.pos.x - car.pos.x, p.pos.z - car.pos.z);
      let dh = target - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const steer = clamp(dh * 1.8, -1, 1);
      const throttle = d > 6 ? 1 : 0.4;
      car.drive(throttle, steer, dt, false);
      // Light bar alternates red/blue on a sim-time square wave.
      const phase = Math.floor(simNow * 4) % 2 === 0;
      if (car._barR) {
        car._barR.material.color.setHex(phase ? 0xff2222 : 0x551111);
        car._barB.material.color.setHex(phase ? 0x112255 : 0x2255ff);
      }
      // Ram: contact with the player's car damages it; contact on foot hurts Mara.
      if (d < 3.4 && car.speed > 4) {
        if (p.car) {
          if (p.car.damage(6 * dt * 10)) {
            if (state.onCarWrecked) state.onCarWrecked(p.car);
          }
          p.car.speed *= 0.92;
        } else if (state.sim.tick % 30 === 0) {
          p.damage(6, 'police ram');
        }
        state.fx.burst(p.pos.x, 1.2, p.pos.z, 0xff5533, 2, 3);
        // Thud + shake on the hit, tick-gated so it fires once per ram.
        if (state.sim.tick % 45 === 0) {
          state.audio.thud();
          state.fx.addShake(0.35);
        }
      }
      if (d > 260) {
        car.dispose();
        this.cars.splice(this.cars.indexOf(car), 1);
      }
    }
    // Officers chase on foot; arrest if Mara is on foot, slow, and close.
    for (const off of this.officers) {
      const d = dist2d(off.pos.x, off.pos.z, p.pos.x, p.pos.z);
      off.heading = Math.atan2(p.pos.x - off.pos.x, p.pos.z - off.pos.z);
      const speed = d > 2 ? off.speed : 0;
      off.pos.x += Math.sin(off.heading) * speed * dt;
      off.pos.z += Math.cos(off.heading) * speed * dt;
      off.mesh.rotation.y = off.heading;
      const swing = Math.sin(simNow * 11 + off.id) * 0.5;
      off.mesh.userData.legL.rotation.x = swing;
      off.mesh.userData.legR.rotation.x = -swing;
      if (d < 2.4 && !p.car) {
        this.bustedHoldT += dt;
        if (this.bustedHoldT >= 3) {
          this.bustedHoldT = 0;
          state.busted();
        }
      } else {
        this.bustedHoldT = Math.max(0, this.bustedHoldT - dt);
      }
    }
    // Wanted decay: no crime for a full sim interval while no police is near.
    if (this.wanted > 0 && simNow - this.lastCrimeT > 26) {
      const near = this.cars.some(
        (c) => dist2d(c.pos.x, c.pos.z, p.pos.x, p.pos.z) < 40,
      );
      if (!near) {
        this.heat = Math.max(0, this.heat - dt * 4);
        if (this.heat < 8) {
          this.setWanted(0, 'escaped');
        } else {
          const level = heatToLevel(this.heat);
          if (level < this.wanted) this.wanted = level;
        }
      }
    }
  }

  clearAll() {
    for (const c of this.cars) c.dispose();
    this.cars = [];
    for (const o of this.officers) this.scene.remove(o.mesh);
    this.officers = [];
    this.wanted = 0;
    this.heat = 0;
    this.bustedHoldT = 0;
  }
}
