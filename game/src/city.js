// city.js — Solmaris itself: a sun-soaked Mediterranean coastal city.
// Grid of streets, whitewashed old town, marina, beachfront boulevard,
// cliffside coast highway, hillside villas, glass downtown, lighthouse.
// The layout is built ONCE from the world stream at init, so the same seed
// always builds the same city. Facades, street props and clouds draw from
// the props stream, so dressing can never shift gameplay draws.
// No clocks, no unseeded randomness anywhere in this file.

import { range, pick } from './random.js';

const WALL_COLORS = [0xf7f2e7, 0xfff6e0, 0xf2e3c9, 0xe8dcc8, 0xfdfaf2, 0xead9b8];
const ROOF_COLORS = [0xc96f4a, 0xb85c38, 0xd98a5f, 0x7a9e7e, 0x4a7fa5];
const PASTEL = [0xf2c14e, 0xe88ca0, 0x7fb5d5, 0x9ec98f, 0xe0a458];
const ROAD_XS = [-198, -120, -60, 0, 60, 120, 180];
const ROAD_ZS = [-180, -120, -60, 0, 60, 120, 180];

export class City {
  constructor(scene, rngWorld, rngProps) {
    this.scene = scene;
    this.rng = rngWorld;
    this.rngProps = rngProps || rngWorld;
    this.buildings = [];
    this.trees = [];
    this.tokens = [];
    this.roadXs = ROAD_XS.slice();
    this.roadZs = ROAD_ZS.slice();
    this._buildFacadeTextures();
    this._buildGround(scene);
    this._buildRoads(scene);
    this._buildBlocks(scene);
    this._buildMarina(scene);
    this._buildLighthouse(scene);
    this._buildTokens(scene);
    this._buildProps(scene);
    this._buildStreetProps(scene);
    this._buildClouds(scene);
    this._buildSunDisc(scene);
    this._buildSailboats(scene);
  }

  // Facade textures: a flat box reads as a placeholder; a window grid, a
  // door band and plaster variation read as a building. One canvas per
  // palette, drawn once at init (a few lit windows from the props stream,
  // in a fixed order). Clones get a per-building horizontal repeat so the
  // window size stays constant whatever the building width.
  _buildFacadeTextures() {
    const mk = (base, win, lit) => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = base;
      g.fillRect(0, 0, 128, 256);
      // Plaster variation: faint light/dark patches.
      for (let i = 0; i < 10; i++) {
        g.fillStyle =
          this.rngProps() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
        g.fillRect(
          Math.floor(this.rngProps() * 100),
          Math.floor(this.rngProps() * 220),
          28,
          20,
        );
      }
      // Window grid: 4 columns x 8 rows, some lit.
      for (let r = 0; r < 8; r++) {
        for (let col = 0; col < 4; col++) {
          const x = 8 + col * 30;
          const y = 10 + r * 30;
          g.fillStyle = this.rngProps() < 0.18 ? lit : win;
          g.fillRect(x, y, 20, 20);
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fillRect(x, y, 20, 3);
        }
      }
      // Door band at the bottom.
      g.fillStyle = '#4a3428';
      g.fillRect(54, 232, 20, 24);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    };
    this._facades = [
      mk('#f7f2e7', '#2e4a6a', '#ffd23f'),
      mk('#fff6e0', '#33475e', '#ffe9a8'),
      mk('#f2e3c9', '#2e4a6a', '#ffd23f'),
    ];
    // Glass tower texture: floor lines + vertical mullions.
    const gc = document.createElement('canvas');
    gc.width = 128;
    gc.height = 256;
    const gg = gc.getContext('2d');
    gg.fillStyle = '#7fb5d5';
    gg.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 256; y += 16) {
      gg.fillStyle = 'rgba(255,255,255,0.35)';
      gg.fillRect(0, y, 128, 2);
      gg.fillStyle = 'rgba(20,40,70,0.35)';
      gg.fillRect(0, y + 8, 128, 2);
    }
    for (let x = 0; x < 128; x += 16) {
      gg.fillStyle = 'rgba(255,255,255,0.18)';
      gg.fillRect(x, 0, 2, 256);
    }
    const gtex = new THREE.CanvasTexture(gc);
    gtex.colorSpace = THREE.SRGBColorSpace;
    gtex.wrapS = THREE.RepeatWrapping;
    gtex.wrapT = THREE.RepeatWrapping;
    this._glassTex = gtex;
  }

  _facadeMat(w) {
    const tex = pick(this.rngProps, this._facades).clone();
    tex.repeat.set(Math.max(1, Math.round(w / 14)), 1);
    tex.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: tex });
  }

  _mat(color) {
    return new THREE.MeshLambertMaterial({ color });
  }

  _box(w, h, d, color, x, y, z, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat(color));
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  _buildGround(scene) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      this._mat(0xe6d9b8),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    // Deep-blue sea west of the coast highway (x < -210), beach strip beside it.
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(176, 560),
      this._mat(0x1e6fa8),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-292, 0.05, 0);
    scene.add(sea);
    const beach = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 560),
      this._mat(0xf2e2b8),
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(-205, 0.06, 0);
    scene.add(beach);
    // White foam where the sea meets the beach.
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 560),
      this._mat(0xfdfaf2),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(-210, 0.065, 0);
    scene.add(foam);
    // Grass hills east / north-east.
    const hill = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      this._mat(0x9ec98f),
    );
    hill.rotation.x = -Math.PI / 2;
    hill.position.set(180, 0.04, -180);
    scene.add(hill);
  }

  _buildRoads(scene) {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x3c3f45 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2e14e });
    const mkRoad = (w, d, x, z) => {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.08, z);
      r.receiveShadow = true;
      scene.add(r);
    };
    for (const x of ROAD_XS) mkRoad(10, 480, x, 0);
    for (const z of ROAD_ZS) mkRoad(480, 10, 0, z);
    // Centre dashes along the two showcase roads.
    for (let z = -230; z <= 230; z += 12) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4), lineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(-198, 0.1, z);
      scene.add(dash);
    }
    for (let x = -230; x <= 230; x += 12) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), lineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.1, 180);
      scene.add(dash);
    }
  }

  _buildBlocks(scene) {
    const rng = this.rng;
    // Old town: dense low whitewashed blocks around the square (0,0).
    // Blocks sit at cell centres (roads run on multiples of 60), so no
    // building ever stands on a road; the four cells around the square
    // stay open as the plaza.
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        const cx = gx * 60 + (gx >= 0 ? 30 : -30) + range(rng, -4, 4);
        const cz = gz * 60 + (gz >= 0 ? 30 : -30) + range(rng, -4, 4);
        if (Math.abs(cx) < 38 && Math.abs(cz) < 38) continue; // the square
        const h = range(rng, 7, 15);
        const w = range(rng, 18, 30);
        const d = range(rng, 18, 30);
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          this._facadeMat(w),
        );
        b.position.set(cx, h / 2, cz);
        b.castShadow = true;
        b.receiveShadow = true;
        scene.add(b);
        const roof = this._box(w + 1, 0.8, d + 1, pick(rng, ROOF_COLORS), cx, h + 0.4, cz);
        this.buildings.push(b, roof);
        // Rooftop props: AC units and water tanks break up flat rooflines.
        if (this.rngProps() < 0.55) {
          const ac = this._box(
            range(this.rngProps, 1.2, 2), 0.9, range(this.rngProps, 1, 1.6),
            0x9aa0a6,
            cx + range(this.rngProps, -6, 6), h + 1.2,
            cz + range(this.rngProps, -6, 6), false,
          );
          this.buildings.push(ac);
        }
        if (this.rngProps() < 0.3) {
          const tank = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2.2, 10),
            this._mat(0x7a9e7e),
          );
          tank.position.set(
            cx + range(this.rngProps, -7, 7), h + 1.9,
            cz + range(this.rngProps, -7, 7),
          );
          tank.castShadow = true;
          scene.add(tank);
          this.buildings.push(tank);
        }
        if (rng() < 0.5) {
          const awning = this._box(8, 0.4, 4, pick(rng, PASTEL), cx + 8, 3.2, cz + 10, false);
          this.buildings.push(awning);
        }
      }
    }
    // Downtown glass towers east.
    for (let i = 0; i < 7; i++) {
      const x = 120 + range(rng, -14, 34);
      const z = -150 + i * 34 + range(rng, -6, 6);
      const h = range(rng, 34, 62);
      const gtex = this._glassTex.clone();
      gtex.needsUpdate = true;
      const glass = new THREE.MeshLambertMaterial({
        map: gtex,
        transparent: true,
        opacity: 0.9,
      });
      const t = new THREE.Mesh(new THREE.BoxGeometry(20, h, 20), glass);
      t.position.set(x, h / 2, z);
      t.castShadow = true;
      scene.add(t);
      this.buildings.push(t);
      // Rooftop antenna on the taller towers.
      if (h > 48) {
        const ant = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.3, 9, 6),
          this._mat(0x888888),
        );
        ant.position.set(x, h + 4.5, z);
        scene.add(ant);
        this.buildings.push(ant);
      }
    }
    // Hillside villas north-east.
    for (let i = 0; i < 9; i++) {
      const x = range(rng, 90, 210);
      const z = range(rng, -230, -150);
      const h = range(rng, 6, 10);
      const w = range(rng, 12, 18);
      const d = range(rng, 12, 18);
      const v = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        this._facadeMat(w),
      );
      v.position.set(x, h / 2, z);
      v.castShadow = true;
      v.receiveShadow = true;
      scene.add(v);
      this.buildings.push(v);
    }
    // Old Town square fountain + market stalls.
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5.4, 1, 20),
      this._mat(0xd8cfc0),
    );
    basin.position.set(0, 0.5, 0);
    basin.castShadow = true;
    scene.add(basin);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 4.4, 0.4, 20),
      this._mat(0x3fa7d6),
    );
    water.position.set(0, 1.0, 0);
    scene.add(water);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 3.4, 10),
      this._mat(0xf7f2e7),
    );
    pillar.position.set(0, 2.4, 0);
    scene.add(pillar);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sx = Math.cos(a) * 14;
      const sz = Math.sin(a) * 14;
      this._box(5, 2.6, 4, pick(rng, PASTEL), sx, 1.3, sz);
      this._box(5.6, 0.3, 4.6, 0xd94f3d, sx, 2.9, sz, false);
    }
  }

  _buildMarina(scene) {
    // Marina piers + yachts south-east (150, 150).
    for (let i = 0; i < 3; i++) {
      const pier = this._box(4, 0.6, 60, 0x8a6f4d, 120 + i * 30, 0.3, 150);
      this.buildings.push(pier);
      for (let j = 0; j < 3; j++) {
        const y = this._box(4, 2.2, 12, 0xffffff, 112 + i * 30, 1.1, 132 + j * 18);
        const mast = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 9, 6),
          this._mat(0x888888),
        );
        mast.position.set(112 + i * 30, 6, 132 + j * 18);
        scene.add(mast);
        this.buildings.push(y);
      }
    }
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 90),
      this._mat(0x2a7fc2),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(150, 0.07, 150);
    scene.add(water);
  }

  _buildLighthouse(scene) {
    // Lighthouse at the north end of the coast highway — the finale destination.
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 5.5, 34, 14),
      this._mat(0xf7f2e7),
    );
    tower.position.set(-198, 17, -228);
    tower.castShadow = true;
    scene.add(tower);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(4.3, 4.3, 3, 14),
      this._mat(0xd94f3d),
    );
    band.position.set(-198, 26, -228);
    scene.add(band);
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 4, 14),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    );
    lamp.position.set(-198, 35.5, -228);
    scene.add(lamp);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(3.6, 3.4, 14),
      this._mat(0x2e4a6a),
    );
    cap.position.set(-198, 39, -228);
    scene.add(cap);
    this.lighthouse = { x: -198, z: -228 };
  }

  _buildTokens(scene) {
    // 12 sun tokens at fixed spots near landmarks.
    const spots = [
      [10, 8], [-30, -30], [60, 60], [-120, 120], [150, 120], [-198, -120],
      [0, -180], [180, 0], [-60, 180], [120, -60], [-150, -60], [30, -120],
    ];
    for (let i = 0; i < spots.length; i++) {
      const geo = new THREE.TorusGeometry(0.9, 0.22, 8, 20);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xffd23f }),
      );
      mesh.position.set(spots[i][0], 1.6, spots[i][1]);
      scene.add(mesh);
      this.tokens.push({ id: i, x: spots[i][0], z: spots[i][1], mesh, taken: false });
    }
  }

  _buildProps(scene) {
    const rng = this.rng;
    // Palm trees along the boulevard + beach.
    for (let i = 0; i < 26; i++) {
      const x = range(rng, -200, 210);
      const z = rng() < 0.5 ? 190 + range(rng, -4, 4) : -196 + range(rng, -2, 2);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.4, 5, 7),
        this._mat(0x8a6f4d),
      );
      trunk.position.set(x, 2.5, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 2.4, 8),
        this._mat(0x3f8f4f),
      );
      crown.position.set(x, 6, z);
      scene.add(crown);
      this.trees.push(trunk);
    }
    // Stunt ramp on the boulevard (for jumps) — a proper ramp on support
    // blocks, not a floating slab.
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.4, 10),
      this._mat(0xe8722a),
    );
    ramp.position.set(40, 0.95, 180);
    ramp.rotation.x = -0.22;
    ramp.castShadow = true;
    scene.add(ramp);
    const rampBase = this._box(8, 1.1, 3.5, 0x3c3f45, 40, 0.55, 183.6, false);
    const rampTop = this._box(8, 0.5, 2.5, 0x3c3f45, 40, 0.25, 175.6, false);
    this.buildings.push(rampBase, rampTop);
    this.ramp = { x: 40, z: 180 };
    // Respray garage ("Fresh Coat") at (60, -120): drive in to cool wanted heat.
    const garage = this._box(16, 7, 14, 0x3a6ea8, 60, 3.5, -120);
    this.garage = { x: 60, z: -120, mesh: garage };
    const sign = this._box(14, 1.6, 0.5, 0xf2c14e, 60, 7.6, -112.5, false);
    this.buildings.push(garage, sign);
  }

  // Street dressing: lamps, benches, planters, bins, crosswalks, sidewalks,
  // plaza paving. All seeded from the props stream at init — the street is
  // what the player actually looks at, and an empty plane reads unfinished.
  _buildStreetProps(scene) {
    const rng = this.rngProps;
    const lampMat = this._mat(0x2e3440);
    const lampHead = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const mkLamp = (x, z) => {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 5.2, 6),
        lampMat,
      );
      pole.position.set(x, 2.6, z);
      pole.castShadow = true;
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), lampHead);
      head.position.set(x, 5.4, z);
      scene.add(head);
      this.trees.push(pole);
    };
    for (let x = -210; x <= 210; x += 42) {
      mkLamp(x, 180 + (Math.round(x / 42) % 2 === 0 ? 7.5 : -7.5));
    }
    for (let z = -210; z <= 210; z += 42) {
      mkLamp(-198 + (Math.round(z / 42) % 2 === 0 ? -7.5 : 7.5), z);
    }
    // Benches around the square (seat + legs, facing the fountain).
    for (const [bx, bz] of [[-20, 0], [20, 0], [0, -20], [0, 20]]) {
      this._box(3.2, 0.45, 1.1, 0x8a6f4d, bx, 0.55, bz, false);
      this._box(0.3, 0.55, 1.0, 0x5a4632, bx - 1.3, 0.28, bz, false);
      this._box(0.3, 0.55, 1.0, 0x5a4632, bx + 1.3, 0.28, bz, false);
    }
    // Planters with shrubs near the square corners.
    for (const [px, pz] of [[-24, -24], [24, -24], [-24, 24], [24, 24], [-30, 0], [30, 0]]) {
      this._box(1.7, 0.8, 1.7, 0xc96f4a, px, 0.4, pz, false);
      const shrub = new THREE.Mesh(
        new THREE.SphereGeometry(1.0, 8, 6),
        this._mat(0x3f8f4f),
      );
      shrub.scale.y = 0.8;
      shrub.position.set(px, 1.2, pz);
      shrub.castShadow = true;
      scene.add(shrub);
    }
    // Bins along the boulevard.
    for (const bx of [-150, -90, -30, 30, 90, 150]) {
      const bin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.45, 1.1, 8),
        this._mat(0x3c3f45),
      );
      bin.position.set(bx, 0.55, 187);
      bin.castShadow = true;
      scene.add(bin);
    }
    // Crosswalks: white stripes where the showcase roads meet the grid.
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfdfaf2 });
    const mkCrosswalk = (cx, cz, alongX) => {
      for (let i = -2; i <= 2; i++) {
        const s = new THREE.Mesh(
          new THREE.PlaneGeometry(alongX ? 0.9 : 3.6, alongX ? 3.6 : 0.9),
          stripeMat,
        );
        s.rotation.x = -Math.PI / 2;
        s.position.set(
          alongX ? cx + i * 1.7 : cx,
          0.09,
          alongX ? cz : cz + i * 1.7,
        );
        scene.add(s);
      }
    };
    for (const x of [-120, -60, 0, 60, 120]) mkCrosswalk(x, 180, true);
    for (const z of [-120, 0, 120]) mkCrosswalk(-198, z, false);
    // Sidewalk strips flanking the boulevard + the city side of the highway.
    const walkMat = new THREE.MeshLambertMaterial({ color: 0xd8cfc0 });
    const mkWalk = (w, d, x, z) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), walkMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(x, 0.07, z);
      p.receiveShadow = true;
      scene.add(p);
    };
    mkWalk(460, 3, 0, 187.5);
    mkWalk(460, 3, 0, 172.5);
    mkWalk(3, 460, -190.5, 0);
    // Plaza paving: a lighter stone disc over the Old Town square.
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(26, 28),
      this._mat(0xefe6cc),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.07, 0);
    plaza.receiveShadow = true;
    scene.add(plaza);
  }

  _buildClouds(scene) {
    const rng = this.rngProps;
    this.clouds = [];
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rng() * 2);
      for (let j = 0; j < n; j++) {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(range(rng, 6, 11), 10, 8),
          mat,
        );
        s.scale.y = 0.45;
        s.position.set(
          j * range(rng, 7, 10) - n * 4,
          range(rng, -1, 1),
          range(rng, -4, 4),
        );
        g.add(s);
      }
      const bx = range(rng, -300, 300);
      const bz = range(rng, -280, 280);
      g.position.set(bx, range(rng, 95, 135), bz);
      scene.add(g);
      this.clouds.push({ group: g, baseX: bx, speed: range(rng, 0.6, 1.4) });
    }
  }

  // Clouds drift with sim time only — a pure function of sim time, so the
  // same tick always shows the same sky.
  updateClouds(simNow) {
    for (const c of this.clouds) {
      let x = c.baseX + simNow * c.speed;
      x = ((x + 340) % 680) - 340;
      c.group.position.x = x;
    }
  }

  _buildSunDisc(scene) {
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(11, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }),
    );
    scene.add(disc);
    this.sunDisc = disc;
  }

  _buildSailboats(scene) {
    const rng = this.rngProps;
    for (let i = 0; i < 3; i++) {
      const x = range(rng, -330, -250);
      const z = range(rng, -160, 160);
      const hull = this._box(3, 1.2, 8, 0xffffff, x, 0.6, z, false);
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 8, 6),
        this._mat(0x8a6f4d),
      );
      mast.position.set(x, 4.5, z);
      scene.add(mast);
      const sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0);
      sailShape.lineTo(0, 7);
      sailShape.lineTo(4.5, 0);
      sailShape.closePath();
      const sail = new THREE.Mesh(
        new THREE.ShapeGeometry(sailShape),
        new THREE.MeshBasicMaterial({ color: 0xfff6e0, side: THREE.DoubleSide }),
      );
      sail.position.set(x + 0.2, 1.2, z);
      scene.add(sail);
      this.buildings.push(hull);
    }
  }

  isOnRoad(x, z) {
    for (const rx of this.roadXs) if (Math.abs(x - rx) < 6) return true;
    for (const rz of this.roadZs) if (Math.abs(z - rz) < 6) return true;
    return false;
  }

  randomRoadPoint(rng) {
    if (rng() < 0.5) {
      return { x: pick(rng, this.roadXs), z: range(rng, -220, 220) };
    }
    return { x: range(rng, -220, 220), z: pick(rng, this.roadZs) };
  }
}
