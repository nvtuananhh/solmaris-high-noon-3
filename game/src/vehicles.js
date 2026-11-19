// vehicles.js — drivable cars: mesh, arcade handling, damage, lights.
// A Car is a THREE group (body, cabin, four wheels, head- and taillights)
// plus sim state. It holds no randomness of its own; colours and kinds are
// chosen by the caller from that caller's own seeded stream.

import { clamp } from './config.js';

export const CAR_COLORS = [
  0xd94f3d, 0x3a6ea8, 0xf2c14e, 0xe8e4da,
  0x2e4a6a, 0x7fb069, 0xe88ca0, 0x8a5a9e,
];

export const CAR_KINDS = {
  sedan: { accel: 15, maxSpeed: 30, len: 4.4, wid: 1.9 },
  sport: { accel: 20, maxSpeed: 38, len: 4.2, wid: 1.85 },
  van: { accel: 11, maxSpeed: 24, len: 5.2, wid: 2.1 },
  taxi: { accel: 15, maxSpeed: 30, len: 4.4, wid: 1.9 },
};

export class Car {
  constructor(scene, x, z, heading, color, kind, opts = {}) {
    this.scene = scene;
    this.kind = kind || 'sedan';
    this.spec = CAR_KINDS[this.kind] || CAR_KINDS.sedan;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = 100;
    this.driver = opts.driver !== undefined ? opts.driver : 'npc';
    this.stolen = false;
    this.isPolice = false;
    this.id = opts.id !== undefined ? opts.id : 0;
    this.mesh = this._buildMesh(color);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
  }

  _buildMesh(color) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x223344 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const L = this.spec.len;
    const W = this.spec.wid;

    const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.72, L), bodyMat);
    body.position.y = 0.62;
    body.castShadow = true;
    g.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.82, 0.62, L * 0.45),
      glassMat,
    );
    cabin.position.set(0, 1.24, -L * 0.05);
    cabin.castShadow = true;
    g.add(cabin);

    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
    this.wheels = [];
    const wheelSpots = [
      [-W / 2, L / 2 - 0.8],
      [W / 2, L / 2 - 0.8],
      [-W / 2, -L / 2 + 0.8],
      [W / 2, -L / 2 + 0.8],
    ];
    for (const [wx, wz] of wheelSpots) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.36, wz);
      g.add(w);
      this.wheels.push(w);
    }

    // Headlights: two small bright boxes at the front (+z is forward).
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    for (const lx of [-W / 2 + 0.3, W / 2 - 0.3]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.1), lightMat);
      hl.position.set(lx, 0.62, L / 2 + 0.02);
      g.add(hl);
    }
    // Taillights: dim red until the brakes flare them.
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xd92b2b });
    for (const lx of [-W / 2 + 0.3, W / 2 - 0.3]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.1), tailMat);
      tl.position.set(lx, 0.62, -L / 2 - 0.02);
      g.add(tl);
    }
    this._tailMat = tailMat;
    return g;
  }

  // Arcade handling for one fixed tick. Throttle and steer are -1..1.
  drive(throttle, steerInput, dt, handbrake) {
    const spec = this.spec;
    if (throttle > 0) {
      this.speed += spec.accel * throttle * dt;
    } else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= 26 * dt;
      else this.speed -= spec.accel * 0.6 * dt;
    }
    // Drag + rolling resistance.
    this.speed -= this.speed * 0.55 * dt;
    if (handbrake) this.speed -= this.speed * 3.2 * dt;
    this.speed = clamp(this.speed, -spec.maxSpeed * 0.26, spec.maxSpeed);
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    const steerTarget = steerInput * 1.9;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    const dir = this.speed >= 0 ? 1 : -1;
    this.heading +=
      this.steer * dt * dir * clamp(Math.abs(this.speed) / 8, 0, 1) * 1.35;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    // Keep inside the city.
    this.pos.x = clamp(this.pos.x, -236, 236);
    this.pos.z = clamp(this.pos.z, -236, 236);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;

    const spin = (this.speed * dt) / 0.36;
    for (const w of this.wheels) w.rotation.x += spin;
    // Body roll from steering — a pure function of steer and speed.
    this.mesh.rotation.z =
      -this.steer * 0.03 * clamp(Math.abs(this.speed) / 12, 0, 1);
    // Brake lights flare while braking or handbraking.
    if (this._tailMat) {
      this._tailMat.color.setHex(handbrake || throttle < 0 ? 0xff4444 : 0xd92b2b);
    }
  }

  damage(amount) {
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    return this.health <= 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
