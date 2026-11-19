// traffic.js — ambient traffic AI.
// Cars follow the road grid, keep distance, and honk when blocked. Spawns
// come from the traffic stream at init only; per-tick behaviour is pure
// logic over sim state (the only fresh draw is one per turn at a grid edge).

import { Car, CAR_COLORS } from './vehicles.js';
import { pick, range } from './random.js';
import { dist2d } from './config.js';

export class Traffic {
  constructor(scene, city, rngTraffic) {
    this.scene = scene;
    this.city = city;
    this.rng = rngTraffic;
    this.cars = [];
    this._spawnInitial();
  }

  _spawnInitial() {
    const rng = this.rng;
    for (let i = 0; i < 14; i++) {
      const p = this.city.randomRoadPoint(rng);
      const heading = rng() < 0.5 ? 0 : Math.PI;
      const kind = pick(rng, ['sedan', 'sedan', 'sport', 'van', 'taxi']);
      const car = new Car(this.scene, p.x, p.z, heading, pick(rng, CAR_COLORS), kind, {
        driver: 'npc',
        id: 100 + i,
      });
      car.cruise = range(rng, 7, 13);
      car.waitT = 0;
      car.pathDir = rng() < 0.5 ? 1 : -1;
      // Loop waypoints: drive along the current road, turn at the grid edge.
      car.axis = rng() < 0.5 ? 'x' : 'z';
      this.cars.push(car);
    }
    // A few parked cars to steal (driver null, engine off).
    const parked = [
      [-8, 30, 0.4],
      [24, -60, 1.2],
      [-60, 84, 0],
      [120, 24, -0.6],
      [6, 120, 2.2],
      [-180, 60, 0],
    ];
    for (let i = 0; i < parked.length; i++) {
      const [x, z, h] = parked[i];
      const car = new Car(
        this.scene,
        x,
        z,
        h,
        pick(rng, CAR_COLORS),
        pick(rng, ['sedan', 'sport', 'van']),
        { driver: null, id: 200 + i },
      );
      car.cruise = 0;
      car.parked = true;
      this.cars.push(car);
    }
  }

  // Parked cars and NPC cars are both stealable; only `exclude` is skipped.
  nearestCar(x, z, maxDist, exclude) {
    let best = null;
    let bestD = maxDist;
    for (const c of this.cars) {
      if (c === exclude) continue;
      const d = dist2d(x, z, c.pos.x, c.pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  update(dt, state) {
    const rng = this.rng;
    for (const car of this.cars) {
      if (car.parked) continue;
      if (car.driver === 'player') continue;
      // Car ahead? Slow down. Blocked for a while? Honk — only when the
      // blocked timer crosses a whole second, keyed to sim time.
      const ahead = this._carAhead(car);
      let throttle = 1;
      if (ahead) {
        throttle = 0;
        car.waitT += dt;
        if (car.waitT > 1 && Math.floor(car.waitT) !== Math.floor(car.waitT - dt)) {
          state.audio.honk();
        }
      } else {
        car.waitT = 0;
        // Cruise at the seeded speed: throttle tapers near cruise speed.
        if (car.speed > car.cruise) throttle = 0;
      }
      // Grid driving: follow the current axis, turn at the boundary, pick
      // the next axis from the traffic stream (one draw per turn only).
      let steer = 0;
      if (car.axis === 'z') {
        const targetHeading = car.pathDir > 0 ? 0 : Math.PI;
        steer = this._steerTo(car, targetHeading);
        if (
          (car.pathDir > 0 && car.pos.z > 225) ||
          (car.pathDir < 0 && car.pos.z < -225)
        ) {
          car.axis = 'x';
          car.pathDir = rng() < 0.5 ? 1 : -1;
        }
      } else {
        const targetHeading = car.pathDir > 0 ? Math.PI / 2 : -Math.PI / 2;
        steer = this._steerTo(car, targetHeading);
        if (
          (car.pathDir > 0 && car.pos.x > 225) ||
          (car.pathDir < 0 && car.pos.x < -225)
        ) {
          car.axis = 'z';
          car.pathDir = rng() < 0.5 ? 1 : -1;
        }
      }
      car.drive(throttle, steer, dt, false);
    }
  }

  _steerTo(car, target) {
    let d = target - car.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.max(-1, Math.min(1, d * 1.6));
  }

  _carAhead(car) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of this.cars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < 9 && side < 2.2) return other;
    }
    return null;
  }
}
