// effects.js — particles, muzzle flashes, screen shake, skid dust.
// Spawn jitter comes from the effects RNG stream. Lifetimes and motion are
// driven by the fixed sim dt and sim time only. Particles live in a fixed
// pool of meshes, so the hot path never allocates per tick.

import { range } from './random.js';

export class Effects {
  constructor(scene, rngEffects) {
    this.scene = scene;
    this.rng = rngEffects;
    this.shake = 0;
    this.parts = [];
    this._cursor = 0;
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        transparent: true,
        opacity: 0,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.parts.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
    }
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  burst(x, y, z, color, count, speed) {
    for (let n = 0; n < count; n++) {
      const p = this.parts[this._cursor];
      this._cursor = (this._cursor + 1) % this.parts.length;
      p.mesh.visible = true;
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 1;
      p.mesh.position.set(x, y, z);
      const a = range(this.rng, 0, Math.PI * 2);
      const up = range(this.rng, 0.4, 1);
      const radial = range(this.rng, 0.4, 1);
      p.vx = Math.cos(a) * speed * radial;
      p.vz = Math.sin(a) * speed * radial;
      p.vy = up * speed;
      p.maxLife = range(this.rng, 0.35, 0.8);
      p.life = p.maxLife;
    }
  }

  muzzle(x, y, z) {
    this.burst(x, y, z, 0xffe066, 6, 5);
  }

  impact(x, y, z) {
    this.burst(x, y, z, 0x9aa0a6, 8, 4);
  }

  dust(x, y, z) {
    this.burst(x, y, z, 0xd8c9a3, 3, 1.6);
  }

  tokenSparkle(x, y, z) {
    this.burst(x, y, z, 0xffd23f, 12, 3.2);
  }

  update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
    for (const p of this.parts) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
        continue;
      }
      p.vy -= 9 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vy = 0;
      }
      p.mesh.material.opacity = p.life / p.maxLife;
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 5;
    }
  }

  // Screen-shake offset as a pure function of sim time and shake amount.
  shakeOffset(simNow) {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const s = this.shake * 0.35;
    return { x: Math.sin(simNow * 61.7) * s, y: Math.cos(simNow * 53.3) * s };
  }
}
