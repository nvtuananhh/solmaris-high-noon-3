// main.js — Solmaris "High Noon" boot + fixed-timestep loop + player.
//
// Determinism contract (the whole point of this rebuild):
//  - ONE sim clock: sim.now advances only by the fixed dt (1/60) per tick.
//    Every animation, timer, cooldown, blink, bob and flicker reads sim.now.
//  - The loop is fixed-timestep: each animation frame steps exactly ONE
//    tick and ignores the frame timestamp argument entirely.
//  - ALL randomness flows through seeded streams (random.js) created once
//    from the URL seed (?seed=N, default 1).
//  - Save/load uses sim time only; IDs come from a monotonic counter.
//  - No unseeded random source and no wall-clock read exists in this file.

import * as THREE from '../vendor/three.min.js';
import { CFG, clamp, dist2d, fmtClock, fnv1a, angleLerp } from './config.js';
import { makeStreams } from './random.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { City } from './city.js';
import { Car } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions, MISSION_DEFS } from './missions.js';
import { HUD } from './hud.js';
import { Minimap } from './minimap.js';
import { Effects } from './effects.js';
import {
  saveGame, loadGame, hasSave, loadSettings, saveSettings, applySave,
} from './save.js';
import { applyShot, SHOT_MODES } from './shots.js';

// The other game modules address THREE as a global at call time; publish
// the vendored module build there before anything constructs a scene object.
window.THREE = THREE;

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot');
const HASH_AFTER = params.has('hashAfter')
  ? parseInt(params.get('hashAfter'), 10)
  : -1;
const SCRIPT = params.get('script') || '';
const AUTOSTART =
  params.get('autostart') === '1' || HASH_AFTER >= 0 || !!SHOT;

function buildMaraMesh() {
  // Mara Voss, 28: red courier jacket, dark hair, jeans — unmistakable at a glance.
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0xc22a2a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const jeans = new THREE.MeshLambertMaterial({ color: 0x2e4a6a });
  const hairM = new THREE.MeshLambertMaterial({ color: 0x20140c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.88, 0.36), jacket);
  body.position.y = 1.12;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.42), skin);
  head.position.y = 1.8;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.2, 0.46), hairM);
  hair.position.y = 2.04;
  g.add(hair);
  const ponytail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.16), hairM);
  ponytail.position.set(0, 1.8, -0.3);
  g.add(ponytail);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.78, 0.27), jeans);
  legL.position.set(-0.17, 0.39, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.17;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.72, 0.21), jacket);
  armL.position.set(-0.44, 1.15, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.44;
  g.add(armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

function init() {
  const settings = loadSettings();
  const sim = { now: 0, tick: 0, dt: CFG.dt };
  const streams = makeStreams(SEED);

  // --- renderer / scene / camera: bright midday, hard sun, short shadows ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x9fd4ef, 260, 620);
  const camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 1200,
  );
  camera.position.set(20, 12, 40);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
  sun.position.set(120, 220, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 600;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0xe6d9b8, 0.9);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  // --- the one state object every system reads ---
  const state = {
    sim, streams, scene, renderer, camera,
    cash: CFG.startCash,
    wanted: 0,
    minutes: CFG.startMinutes,
    objective: 'Welcome to Solmaris — press M to start your first job',
    marker: null,
    missionIndex: 0,
    missionStage: 0,
    missionTimer: 0,
    missionsDone: [],
    tokensCollected: new Set(),
    racesWon: 0,
    faresDone: 0,
    kills: 0,
    nextId: 1000,
    started: false,
    paused: false,
    over: false,
    overKind: '',
    shotMode: null,
    shotCam: null,
    cameraYaw: Math.PI * 0.85,
    damageFlashTick: -1,
    camPos: new THREE.Vector3(20, 12, 40),
    settings: { ...settings },
  };
  const hud = new HUD(state);
  state.hud = hud;
  state.flash = (t) => hud.flash(t);
  state.banner = (t) => hud.banner(t);
  const audio = new AudioEngine(streams.audio);
  audio.setVolume(settings.volume);
  state.audio = audio;
  const input = new Input(renderer.domElement);
  state.input = input;
  input.onFirstGesture = () => audio.ensure();
  const fx = new Effects(scene, streams.effects);
  state.fx = fx;
  const city = new City(scene, streams.world, streams.props);
  state.city = city;

  // --- sim-clock day cycle: sun angle/colour, sky, fog and the sun disc
  // are pure functions of the in-game clock (state.minutes), so the same
  // tick always shows the same light. Noon is the reference look (sun
  // elevation 59 deg, azimuth 63.5 deg); the light warms toward golden
  // hour as the day advances, and falls to cool moonlight after 18:00.
  const noonSky = new THREE.Color(0x87ceeb);
  const duskSky = new THREE.Color(0xf7b267);
  const noonSunCol = new THREE.Color(0xfff2d8);
  const duskSunCol = new THREE.Color(0xff9a4d);
  const noonFogCol = new THREE.Color(0x9fd4ef);
  const duskFogCol = new THREE.Color(0xe8a06a);
  const nightSky = new THREE.Color(0x16233d);
  const nightSunCol = new THREE.Color(0x8fa8d8);
  const SUN_AZ = (63.5 * Math.PI) / 180;
  const SUN_R = 260;
  function updateDaylight() {
    const m = state.minutes;
    const dayT = (m - 360) / 720; // 0 at 06:00, 1 at 18:00
    if (dayT >= 0 && dayT <= 1) {
      const el = (12 + 47 * Math.sin(dayT * Math.PI)) * Math.PI / 180;
      const warmth = Math.abs(dayT - 0.5) * 2;
      sun.position.set(
        Math.cos(el) * Math.sin(SUN_AZ) * SUN_R,
        Math.sin(el) * SUN_R,
        Math.cos(el) * Math.cos(SUN_AZ) * SUN_R,
      );
      sun.color.lerpColors(noonSunCol, duskSunCol, warmth);
      sun.intensity = 2.6 - warmth * 0.7;
      scene.background.lerpColors(noonSky, duskSky, warmth * 0.75);
      scene.fog.color.lerpColors(noonFogCol, duskFogCol, warmth * 0.75);
      hemi.intensity = 0.9 - warmth * 0.3;
    } else {
      // Night: low cool moonlight, dark sky.
      sun.position.set(60, 120, 40);
      sun.color.copy(nightSunCol);
      sun.intensity = 0.55;
      scene.background.copy(nightSky);
      scene.fog.color.copy(nightSky);
      hemi.intensity = 0.3;
    }
    if (city.sunDisc) {
      city.sunDisc.position.copy(sun.position).normalize().multiplyScalar(520);
    }
  }
  updateDaylight();

  // --- player: Mara on foot ---
  const playerMesh = buildMaraMesh();
  scene.add(playerMesh);
  const player = {
    mesh: playerMesh,
    pos: new THREE.Vector3(0, 0, 16),
    heading: Math.PI * 0.85,
    vy: 0,
    grounded: true,
    health: CFG.playerHealth,
    ammo: CFG.pistolAmmoStart,
    weapon: 'fists',
    car: null,
    damage(amount, source) {
      if (state.over || !state.started) return;
      this.health -= amount;
      state.damageFlashTick = sim.tick;
      fx.addShake(0.45);
      hud.flash('-' + Math.round(amount) + ' HP (' + source + ')');
      if (this.health <= 0) {
        this.health = 0;
        wasted();
      }
    },
  };
  state.player = player;
  playerMesh.position.copy(player.pos);

  // --- systems (fixed construction order, fixed stream draws) ---
  const traffic = new Traffic(scene, city, streams.traffic);
  state.traffic = traffic;
  const peds = new Pedestrians(scene, city, streams.peds);
  state.peds = peds;
  const police = new Police(scene, city, streams.police);
  state.police = police;
  const combat = new Combat(scene, streams.combat);
  state.combat = combat;
  const missions = new Missions(state);
  state.missions = missions;
  const minimap = new Minimap(state);
  state.minimap = minimap;
  // The marina repo target: a red sports car parked in the marina lot.
  const repoCar = new Car(scene, 155, 150, 0.3, 0xd94f3d, 'sport', {
    driver: null,
    id: 250,
  });
  repoCar.parked = true;
  traffic.cars.push(repoCar);
  state.repoCar = repoCar;
  // A health + ammo pickup near the square, so combat is playable from minute one.
  combat.spawnPickup(14, 22, 'health');
  combat.spawnPickup(-12, 26, 'ammo');

  // --- car enter / exit ---
  function enterCar(car) {
    if (player.car) return false;
    car.driver = 'player';
    car.parked = false;
    player.car = car;
    player.mesh.visible = false;
    return true;
  }
  function exitCar() {
    const car = player.car;
    if (!car) return;
    car.driver = null;
    player.car = null;
    player.pos.set(
      car.pos.x - Math.sin(car.heading) * 2.4,
      0,
      car.pos.z - Math.cos(car.heading) * 2.4,
    );
    player.heading = car.heading;
    player.mesh.visible = true;
    player.mesh.position.copy(player.pos);
    player.mesh.rotation.y = player.heading;
  }
  state.enterCar = enterCar;
  state.exitCar = exitCar;

  function stealCar(car) {
    const wasParked = car.parked || car.driver === 'npc';
    enterCar(car);
    if (wasParked) {
      car.stolen = true;
      police.addHeat(12, sim.now);
      hud.flash('Car stolen — the heat is on!');
      audio.honk();
    }
  }

  function wasted() {
    if (state.over) return;
    state.over = true;
    state.overKind = 'wasted';
    hud.showOver(
      'WASTED',
      'Mara is down. The crew will pick up the pieces — for a price. $100 hospital bill.',
    );
    state.cash = Math.max(0, state.cash - 100);
  }
  function busted() {
    if (state.over) return;
    state.over = true;
    state.overKind = 'busted';
    police.clearAll();
    state.wanted = 0;
    hud.showOver(
      'BUSTED',
      'The Solmaris police took Mara in. Bail: $150. The car is impounded.',
    );
    state.cash = Math.max(0, state.cash - 150);
    if (player.car) {
      player.car.driver = null;
      player.car = null;
    }
    player.mesh.visible = true;
  }
  state.busted = busted;
  state.onCarWrecked = (car) => {
    if (car.health <= 0) {
      fx.burst(car.pos.x, 1.2, car.pos.z, 0xff5533, 20, 6);
      fx.addShake(0.9);
      hud.flash('Your car is wrecked!');
      if (player.car === car) exitCar();
      car.speed = 0;
      car.health = 40;
    }
  };
  function respawn() {
    state.over = false;
    state.overKind = '';
    hud.hideOver();
    player.health = CFG.playerHealth;
    player.pos.set(0, 0, 16);
    player.heading = Math.PI * 0.85;
    player.mesh.position.copy(player.pos);
    player.mesh.visible = true;
    player.car = null;
    police.clearAll();
    state.wanted = 0;
    state.started = true;
    hud.flash('Back on the streets of Solmaris');
  }
  state.respawn = respawn;

  // --- fixed-timestep step: exactly one dt tick, in a fixed system order ---
  const prevKeys = new Set();
  function pressed(code) {
    return input.down(code) && !prevKeys.has(code);
  }
  function syncPrevKeys() {
    prevKeys.clear();
    input.keys.forEach((k) => prevKeys.add(k));
  }

  function step() {
    // Pause toggle must work while paused, so it is handled before the
    // early return below (otherwise Esc could never unpause the game).
    if (state.started && !state.over && (pressed('Escape') || pressed('KeyP'))) {
      state.paused = !state.paused;
      hud.showPause(state.paused);
      syncPrevKeys();
      return;
    }
    if (!state.started || state.paused || state.over) {
      // Even when paused, keep the render loop alive; the sim does not advance.
      syncPrevKeys();
      return;
    }
    sim.tick += 1;
    sim.now += sim.dt;
    const dt = sim.dt;
    const now = sim.now;

    // In-game clock advances: 1 sim second = 0.5 game minutes.
    state.minutes += dt * 0.5;
    if (state.minutes >= 24 * 60) state.minutes -= 24 * 60;
    // Light follows the sim clock; clouds drift on sim time.
    updateDaylight();
    city.updateClouds(now);

    // --- edge-triggered actions ---
    if (pressed('KeyE')) {
      if (player.car) {
        exitCar();
      } else {
        const near = traffic.nearestCar(player.pos.x, player.pos.z, 4.5, null);
        if (near) stealCar(near);
      }
    }
    if (pressed('KeyM')) {
      if (state.missionIndex < MISSION_DEFS.length) {
        missions.startMission(state.missionIndex);
      } else {
        hud.flash('Story complete — try a fare (F) or a race (R)');
      }
    }
    if (pressed('KeyF')) missions.startFare();
    if (pressed('KeyR')) missions.startRace();
    if (pressed('Digit1')) {
      player.weapon = 'fists';
      hud.flash('Fists');
    }
    if (pressed('Digit2')) {
      player.weapon = 'pistol';
      hud.flash('Pistol ready');
    }
    if (pressed('KeyK')) {
      const r = saveGame(state);
      hud.flash(r.ok ? 'Saved — ' + r.savedAt : 'Save failed');
    }
    if (pressed('KeyL')) {
      const data = loadGame();
      if (data) {
        applySave(state, data);
        hud.flash('Loaded save — ' + data.savedAt);
      } else {
        hud.flash('No save found');
      }
    }
    // (Pause is toggled at the top of step(), before the early return.)

    // Mouse look: camera yaw from accumulated mouse movement.
    const mdx = input.consumeMouseDX();
    if (mdx !== 0) {
      state.cameraYaw -= mdx * 0.0032 * state.settings.sensitivity;
    }

    // --- player movement ---
    const fwd =
      (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) -
      (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const strafe =
      (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) -
      (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    if (player.car) {
      const car = player.car;
      car.drive(fwd, -strafe, dt, input.down('Space'));
      player.pos.copy(car.pos);
      player.heading = car.heading;
      if (Math.abs(car.speed) > 3 && sim.tick % 20 === 0) {
        fx.dust(car.pos.x, 0.3, car.pos.z - Math.cos(car.heading) * 2);
      }
      if (input.down('Space') && Math.abs(car.speed) > 8) {
        fx.dust(car.pos.x, 0.3, car.pos.z);
      }
      // A battered car smokes — tick-gated, so the effect is deterministic.
      if (car.health < 45 && sim.tick % 12 === 0) {
        fx.burst(car.pos.x, 1.1, car.pos.z, 0x555555, 3, 1.4);
      }
      // Stunt jump: driving over the ramp at speed launches the car (visual only).
      if (
        dist2d(car.pos.x, car.pos.z, 40, 180) < 5 &&
        Math.abs(car.speed) > 18 &&
        car._jumpT !== sim.tick
      ) {
        car._jumpT = sim.tick;
        fx.burst(car.pos.x, 1, car.pos.z, 0xffd23f, 10, 4);
        hud.flash('Stunt jump!');
        state.cash += 20;
      }
    } else {
      const running = input.down('ShiftLeft') || input.down('ShiftRight');
      const speed = running ? CFG.playerRunSpeed : CFG.playerWalkSpeed;
      const moveHeading = state.cameraYaw;
      let mx = 0;
      let mz = 0;
      if (fwd !== 0 || strafe !== 0) {
        mx = Math.sin(moveHeading) * fwd + Math.cos(moveHeading) * strafe;
        mz = Math.cos(moveHeading) * fwd - Math.sin(moveHeading) * strafe;
        const len = Math.sqrt(mx * mx + mz * mz);
        mx /= len;
        mz /= len;
        player.pos.x += mx * speed * dt;
        player.pos.z += mz * speed * dt;
        player.heading = Math.atan2(mx, mz);
      }
      player.pos.x = clamp(player.pos.x, -236, 236);
      player.pos.z = clamp(player.pos.z, -236, 236);
      // Jump (simple vertical hop, gravity from config).
      if (pressed('Space') && player.grounded) {
        player.vy = CFG.playerJumpSpeed;
        player.grounded = false;
      }
      if (!player.grounded) {
        player.vy -= CFG.gravity * dt;
        player.pos.y += player.vy * dt;
        if (player.pos.y <= 0) {
          player.pos.y = 0;
          player.vy = 0;
          player.grounded = true;
        }
      }
      player.mesh.position.copy(player.pos);
      player.mesh.rotation.y = player.heading;
      // Walk cycle keyed to sim time.
      const moving = fwd !== 0 || strafe !== 0;
      const swing = moving ? Math.sin(now * (running ? 11 : 7)) * 0.55 : 0;
      const u = player.mesh.userData;
      u.legL.rotation.x = swing;
      u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.8;
      u.armR.rotation.x = swing * 0.8;
      // Melee / fire (mouse click shoots, G punches).
      if (input.mouseDown || pressed('KeyJ')) {
        if (player.weapon === 'pistol') combat.shoot(state, now);
        else combat.punch(state, now);
      }
      if (pressed('KeyG')) combat.punch(state, now);
    }

    // --- systems, fixed order ---
    const prevWanted = police.wanted;
    traffic.update(dt, state);
    peds.update(dt, now, state);
    police.update(dt, now, state);
    state.wanted = police.wanted;
    // Wanted-level transition feedback: a sting + banner when the heat
    // rises, a quiet flash when it is lost. Pure sim state, deterministic.
    if (state.wanted > prevWanted) {
      hud.banner('WANTED — ' + '★'.repeat(state.wanted));
      audio.sting();
      state.damageFlashTick = sim.tick;
    } else if (state.wanted === 0 && prevWanted > 0) {
      hud.flash('You lost them — heat is off');
    }
    combat.update(dt, now, state);
    missions.update(dt, now);
    fx.update(dt);
    audio.update(now, sim.tick, player.car ? Math.abs(player.car.speed) : 0, state.wanted);
    hud.update(now, sim.tick);
    minimap.draw(now);

    prevKeys.clear();
    input.keys.forEach((k) => prevKeys.add(k));
  }
  state.step = step;
  state.stepMany = (n) => {
    for (let i = 0; i < n; i++) step();
  };
  state.renderOnce = () => {
    updateCamera();
    renderer.render(scene, camera);
  };

  function updateCamera() {
    const p = player;
    if (state.shotCam) {
      camera.position.set(state.shotCam.x, state.shotCam.y, state.shotCam.z);
      camera.lookAt(state.shotCam.lookX, state.shotCam.lookY, state.shotCam.lookZ);
      state.camPos.copy(camera.position);
      return;
    }
    const yaw = state.cameraYaw;
    const dist = p.car ? 11 : 8.5;
    const height = p.car ? 5 : 4.2;
    const cx = p.pos.x - Math.sin(yaw) * dist;
    const cz = p.pos.z - Math.cos(yaw) * dist;
    const sh = fx.shakeOffset(sim.now);
    // Smoothed follow: the camera eases toward its target at a fixed
    // per-frame rate instead of snapping. Visual only (not in the hash);
    // shot cameras snap the smoothed position directly (see shots.js).
    const tx = cx + sh.x;
    const ty = height + sh.y;
    const tz = cz;
    state.camPos.x += (tx - state.camPos.x) * 0.16;
    state.camPos.y += (ty - state.camPos.y) * 0.16;
    state.camPos.z += (tz - state.camPos.z) * 0.16;
    camera.position.copy(state.camPos);
    camera.lookAt(
      p.pos.x + Math.sin(yaw) * 4,
      1.6,
      p.pos.z + Math.cos(yaw) * 4,
    );
    // Camera yaw eases toward the player heading while driving.
    if (p.car) state.cameraYaw = angleLerp(state.cameraYaw, p.heading, 0.02);
  }

  // --- deterministic state hash (for the two-run verification) ---
  function stateHash() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const snap = {
      tick: sim.tick,
      now: Math.round(sim.now * 1000) / 1000,
      minutes: Math.round(state.minutes * 100) / 100,
      px: r2(player.pos.x),
      pz: r2(player.pos.z),
      ph: r2(player.heading),
      health: Math.round(player.health * 100) / 100,
      ammo: player.ammo,
      cash: state.cash,
      wanted: state.wanted,
      heat: Math.round(police.heat * 100) / 100,
      mission: state.missionIndex,
      stage: state.missionStage,
      tokens: state.tokensCollected.size,
      kills: state.kills,
      car: player.car
        ? {
            x: r2(player.car.pos.x),
            z: r2(player.car.pos.z),
            s: r2(player.car.speed),
            h: r2(player.car.health),
          }
        : null,
      traffic: traffic.cars
        .slice(0, 8)
        .map((c) => [r2(c.pos.x), r2(c.pos.z), r2(c.speed)]),
      peds: peds.peds.slice(0, 8).map((q) => [r2(q.pos.x), r2(q.pos.z)]),
      police: police.cars.map((c) => [r2(c.pos.x), r2(c.pos.z), r2(c.speed)]),
      rivals: combat.rivals.map((q) => [r2(q.pos.x), r2(q.pos.z), Math.round(q.health)]),
    };
    const json = JSON.stringify(snap);
    return { hash: fnv1a(json), json };
  }
  state.stateHash = stateHash;

  // --- UI wiring ---
  const $ = (id) => document.getElementById(id);
  const startBtn = $('btn-start');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      audio.ensure();
      state.started = true;
      hud.hideStart();
      missions.setObjective('Welcome to Solmaris — press M to start your first job');
      hud.banner('SOLMARIS — HIGH NOON');
    });
  }
  const contBtn = $('btn-continue');
  if (contBtn) {
    if (!hasSave()) contBtn.style.display = 'none';
    contBtn.addEventListener('click', () => {
      const data = loadGame();
      audio.ensure();
      state.started = true;
      hud.hideStart();
      if (data) {
        applySave(state, data);
        hud.flash('Loaded save — ' + data.savedAt);
      }
    });
  }
  const resumeBtn = $('btn-resume');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      state.paused = false;
      hud.showPause(false);
    });
  }
  const saveBtn = $('btn-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const r = saveGame(state);
      hud.flash(r.ok ? 'Saved — ' + r.savedAt : 'Save failed');
    });
  }
  const loadBtn = $('btn-load');
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const data = loadGame();
      if (data) {
        applySave(state, data);
        state.paused = false;
        hud.showPause(false);
        hud.flash('Loaded save — ' + data.savedAt);
      } else {
        hud.flash('No save found');
      }
    });
  }
  const restartBtn = $('btn-restart');
  if (restartBtn) restartBtn.addEventListener('click', () => respawn());
  const quitBtn = $('btn-quit');
  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      state.paused = false;
      hud.showPause(false);
      state.started = false;
      hud.showStart();
    });
  }
  const vol = $('opt-volume');
  if (vol) {
    vol.value = String(settings.volume);
    vol.addEventListener('input', () => {
      state.settings.volume = parseFloat(vol.value);
      audio.setVolume(state.settings.volume);
      saveSettings(state.settings);
    });
  }
  const sens = $('opt-sens');
  if (sens) {
    sens.value = String(settings.sensitivity);
    sens.addEventListener('input', () => {
      state.settings.sensitivity = parseFloat(sens.value);
      saveSettings(state.settings);
    });
  }

  // --- scripted deterministic run (?script + ?hashAfter) ---
  function parseScript(text) {
    // "W:60,E:5,W:120" — hold key(s) for N ticks each, in order.
    const segs = [];
    for (const part of text.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [keys, n] = t.split(':');
      segs.push({
        keys: keys.split('+'),
        count: parseInt(n || '60', 10) || 60,
      });
    }
    return segs;
  }
  function runScripted() {
    state.started = true;
    hud.hideStart();
    const segs = parseScript(SCRIPT);
    let segIdx = 0;
    let segLeft = segs.length ? segs[0].count : 0;
    const total = HASH_AFTER;
    for (let i = 0; i < total; i++) {
      if (segIdx < segs.length) {
        for (const k of segs[segIdx].keys) input.press('Key' + k);
        segLeft -= 1;
        if (segLeft <= 0) {
          for (const k of segs[segIdx].keys) input.release('Key' + k);
          segIdx += 1;
          if (segIdx < segs.length) segLeft = segs[segIdx].count;
        }
      }
      step();
    }
    const h = stateHash();
    window.__stateHash = h.hash;
    window.__stateJson = h.json;
    window.__hashDone = true;
    document.title = 'hash:' + h.hash;
  }

  // --- test hooks (headless playtest + determinism checks) ---
  window.__game = {
    state,
    sim,
    step,
    stateHash,
    key(code, down) {
      if (down) input.press(code);
      else input.release(code);
    },
    click(down) {
      input.mouseDown = down;
    },
    start() {
      state.started = true;
      hud.hideStart();
    },
    startMission(i) {
      missions.startMission(i);
    },
    save() {
      return saveGame(state);
    },
    load() {
      const d = loadGame();
      if (d) applySave(state, d);
      return d;
    },
    respawn,
    setWanted(n) {
      police.setWanted(n, 'test hook');
      state.wanted = police.wanted;
    },
    shotReady: () => !!window.__shotReady,
  };
  window.__shotModes = SHOT_MODES;

  // --- boot ---
  hud.setObjective(state.objective);
  if (AUTOSTART) {
    state.started = true;
    hud.hideStart();
  }
  if (SHOT && SHOT_MODES.includes(SHOT)) {
    applyShot(state, SHOT);
  } else if (HASH_AFTER >= 0) {
    runScripted();
  }

  // --- fixed-timestep render loop: one tick per frame, timestamp ignored ---
  function frame() {
    step();
    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return state;
}

try {
  init();
} catch (err) {
  const el = document.getElementById('boot-error');
  if (el) {
    el.style.display = 'block';
    el.textContent = 'Boot error: ' + (err && err.message ? err.message : err);
  }
  throw err;
}
