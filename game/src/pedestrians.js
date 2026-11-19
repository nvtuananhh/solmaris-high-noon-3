// pedestrians.js — sidewalk walkers who stroll, idle, and flee gunfire.
// Spawn positions, colours and walk speeds come from the peds stream at
// init. Flee directions also draw from that stream, in fixed array order.
// Arm swing and bob read sim time only — no wall clock anywhere.

import { range, pick } from './random.js';
import { dist2d } from './config.js';

const SHIRTS = [
  0x3a6ea8, 0xd94f3d, 0xf2c14e, 0x7fb069,
  0xe88ca0, 0x8a5a9e, 0xe8e4da, 0x2e4a6a,
];
const SKINS = [0xe8b88a, 0xc98d64, 0x8a5a3b, 0xf0c8a0];
const PANTS = [0x2e4a6a, 0x333333, 0x6a5a4a];

export function buildPersonMesh(shirt, skin, pants) {
  const g = new THREE.Group();
  const shirtM = new THREE.MeshLambertMaterial({ color: shirt });
  const skinM = new THREE.MeshLambertMaterial({ color: skin });
  const pantsM = new THREE.MeshLambertMaterial({ color: pants });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.34), shirtM);
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), skinM);
  head.position.y = 1.68;
  g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.24), pantsM);
  legL.position.set(-0.15, 0.35, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.15;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.66, 0.19), shirtM);
  armL.position.set(-0.4, 1.08, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.4;
  g.add(armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export class Pedestrians {
  constructor(scene, city, rngPeds) {
    this.scene = scene;
    this.city = city;
    this.rng = rngPeds;
    this.peds = [];
    this._spawnInitial();
  }

  _spawnInitial() {
    const rng = this.rng;
    for (let i = 0; i < 22; i++) {
      const x = range(rng, -200, 200);
      const z = range(rng, -200, 200);
      const mesh = buildPersonMesh(
        pick(rng, SHIRTS),
        pick(rng, SKINS),
        pick(rng, PANTS),
      );
      mesh.position.set(x, 0, z);
      this.scene.add(mesh);
      this.peds.push({
        mesh,
        pos: mesh.position,
        heading: range(rng, 0, Math.PI * 2),
        speed: range(rng, 1.0, 2.0),
        phase: range(rng, 0, Math.PI * 2),
        fleeT: 0,
        fleeX: 0,
        fleeZ: 0,
        id: 300 + i,
      });
    }
  }

  // Gunfire nearby: peds within radius flee away from the shot.
  scare(x, z, radius) {
    for (const p of this.peds) {
      if (dist2d(p.pos.x, p.pos.z, x, z) < radius) {
        const dx = p.pos.x - x;
        const dz = p.pos.z - z;
        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        p.fleeX = dx / len;
        p.fleeZ = dz / len;
        p.fleeT = range(this.rng, 2.5, 4.5);
      }
    }
  }

  nearest(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.peds) {
      const d = dist2d(x, z, p.pos.x, p.pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  update(dt, simNow, state) {
    for (const p of this.peds) {
      let speed = p.speed;
      if (p.fleeT > 0) {
        p.fleeT -= dt;
        speed = 5.2;
        p.heading = Math.atan2(p.fleeX, p.fleeZ);
      } else {
        // Wander: gentle heading drift from a pure function of sim time
        // and the ped's seeded phase — no fresh draws per tick.
        p.heading += Math.sin(simNow * 0.3 + p.phase) * 0.12 * dt;
      }
      p.pos.x += Math.sin(p.heading) * speed * dt;
      p.pos.z += Math.cos(p.heading) * speed * dt;
      if (p.pos.x > 232 || p.pos.x < -232 || p.pos.z > 232 || p.pos.z < -232) {
        p.heading += Math.PI;
        p.pos.x = Math.max(-232, Math.min(232, p.pos.x));
        p.pos.z = Math.max(-232, Math.min(232, p.pos.z));
      }
      p.mesh.rotation.y = p.heading;
      // Walk cycle: arm/leg swing keyed to sim time + phase.
      const swing = Math.sin(simNow * (speed * 2.4) + p.phase) * 0.5;
      const u = p.mesh.userData;
      u.legL.rotation.x = swing;
      u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.8;
      u.armR.rotation.x = swing * 0.8;
    }
  }
}
