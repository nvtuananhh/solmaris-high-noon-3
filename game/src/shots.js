// shots.js — deterministic screenshot modes.
// ?shot=chase|foot|drive|combat&seed=1 stages a fixed scene (player, cars,
// police, rivals, wanted level, mission state) with a fixed camera, then
// steps the sim a FIXED number of ticks (120) from the same seed before
// signalling window.__shotReady. Same mode + same seed = same frame.

import { Car } from './vehicles.js';

export const SHOT_MODES = ['chase', 'foot', 'drive', 'combat'];
export const SHOT_TICKS = 120;

export function applyShot(state, mode) {
  const st = state;
  const p = st.player;
  st.shotMode = mode;
  st.started = true;
  st.hud.hideStart();
  if (st.audio) st.audio.setVolume(0);

  const park = (x, z, heading, color, kind) => {
    const c = new Car(st.scene, x, z, heading, color, kind, {
      driver: null,
      id: 900 + st.traffic.cars.length,
    });
    c.parked = true;
    st.traffic.cars.push(c);
    return c;
  };

  if (mode === 'chase') {
    // COVER: police chase on the beachfront boulevard at noon.
    const car = park(-20, 176, Math.PI / 2, 0xd94f3d, 'sport');
    car.parked = false;
    st.enterCar(car);
    car.speed = 22;
    st.police.setWanted(3, 'shot setup');
    st.police._spawnCarNear(p);
    st.police._spawnCarNear(p);
    const pc = st.police.cars;
    if (pc[0]) {
      pc[0].pos.set(-40, 0, 174);
      pc[0].heading = Math.PI / 2;
      pc[0].mesh.rotation.y = Math.PI / 2;
    }
    if (pc[1]) {
      pc[1].pos.set(-56, 0, 180);
      pc[1].heading = Math.PI / 2;
      pc[1].mesh.rotation.y = Math.PI / 2;
    }
    park(6, 172, Math.PI / 2, 0x3a6ea8, 'sedan');
    park(-46, 180, Math.PI / 2, 0xf2c14e, 'van');
    park(28, 180, Math.PI / 2, 0xe8e4da, 'sedan');
    st.missions.setObjective('Heat Wave: survive the dragnet — reach the safehouse!');
    st.missions.setMarker(-150, 30);
    st.cash = 1240;
    // Low, close chase cam: the player's red car fills the frame, the two
    // police cars behind it, boulevard + palms + towers beyond.
    st.shotCam = { x: -40, y: 6.5, z: 160, lookX: -16, lookY: 1.5, lookZ: 177 };
    if (st.camPos) st.camPos.set(st.shotCam.x, st.shotCam.y, st.shotCam.z);
  } else if (mode === 'foot') {
    // On foot in the Old Town square: peds, stalls, fountain, whitewashed walls.
    p.pos.set(6, 0, 16);
    p.heading = Math.PI * 0.9;
    p.car = null;
    p.mesh.position.copy(p.pos);
    p.mesh.visible = true;
    st.missions.setObjective('First Fare: meet Dario at the Old Town square');
    st.missions.setMarker(10, 8);
    st.cash = 120;
    st.shotCam = { x: -8, y: 6, z: 30, lookX: 6, lookY: 1.5, lookZ: 12 };
    if (st.camPos) st.camPos.set(st.shotCam.x, st.shotCam.y, st.shotCam.z);
  } else if (mode === 'drive') {
    // Driving the cliffside coast highway with the sea and skyline behind.
    // The car coasts ~32 units north during the 120 settle ticks (throttle
    // off, drag on), so it ends near (-198,-8): the camera aims there, not
    // at the staging point.
    const car = park(-198, -40, 0, 0x3a6ea8, 'sedan');
    car.parked = false;
    st.enterCar(car);
    car.speed = 26;
    park(-198, -78, 0, 0xf2c14e, 'van');
    park(-198, 28, 0, 0xd94f3d, 'sport');
    park(-192, 30, Math.PI, 0xe8e4da, 'sedan');
    st.missions.setObjective('Free roam — press M for the next mission');
    st.cash = 640;
    // Close over-the-shoulder drive cam: the blue car big in frame, sea to
    // the right, skyline to the left, highway dashes leading the eye north.
    st.shotCam = { x: -194, y: 4, z: -17, lookX: -198, lookY: 1.5, lookZ: -7 };
    if (st.camPos) st.camPos.set(st.shotCam.x, st.shotCam.y, st.shotCam.z);
  } else if (mode === 'combat') {
    // "The Drop" ambush: Mara on foot, pistol out, three rivals closing in.
    p.pos.set(0, 0, -78);
    p.heading = Math.PI;
    p.car = null;
    p.mesh.position.copy(p.pos);
    p.mesh.visible = true;
    p.weapon = 'pistol';
    p.ammo = 24;
    st.combat.spawnRival(-6, -92);
    st.combat.spawnRival(7, -96);
    st.combat.spawnRival(0, -104);
    st.combat.spawnPickup(-4, -84, 'health');
    st.police.setWanted(2, 'shot setup');
    st.missions.setObjective('The Drop: deal with the ambush, then deliver to the Marina');
    st.missions.setMarker(150, 150);
    st.cash = 870;
    st.shotCam = { x: -12, y: 7, z: -58, lookX: 0, lookY: 1.2, lookZ: -92 };
    if (st.camPos) st.camPos.set(st.shotCam.x, st.shotCam.y, st.shotCam.z);
  }

  // Drive the sim a fixed number of ticks so motion, bob and blink settle
  // identically for this seed, then render and signal readiness by frames.
  st.stepMany(SHOT_TICKS);
  st.renderOnce();
  let shotFrames = 0;
  const waitFrames = () => {
    shotFrames += 1;
    if (shotFrames >= 2) {
      window.__shotReady = true;
    } else {
      requestAnimationFrame(waitFrames);
    }
  };
  requestAnimationFrame(waitFrames);
}
