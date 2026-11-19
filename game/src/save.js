// save.js — save / load / settings through localStorage.
// SIM TIME ONLY: the saved stamp is the in-game clock string derived from
// sim minutes. IDs come from monotonic counters stored in the save itself.
// No wall-clock read exists in this file.

import { fmtDayClock } from './config.js';

const SAVE_KEY = 'solmaris-high-noon-save-v1';
const SETTINGS_KEY = 'solmaris-high-noon-settings-v1';

export function saveGame(state) {
  const p = state.player;
  const data = {
    version: 1,
    savedAt: fmtDayClock(state.minutes),
    simTick: state.sim.tick,
    minutes: Math.round(state.minutes * 100) / 100,
    cash: state.cash,
    health: p.health,
    ammo: p.ammo,
    weapon: p.weapon,
    playerX: Math.round(p.pos.x * 100) / 100,
    playerZ: Math.round(p.pos.z * 100) / 100,
    playerHeading: Math.round(p.heading * 1000) / 1000,
    wanted: state.wanted,
    missionIndex: state.missionIndex,
    missionsDone: state.missionsDone.slice(),
    tokensCollected: Array.from(state.tokensCollected),
    faresDone: state.faresDone,
    racesWon: state.racesWon,
    kills: state.kills,
    nextId: state.nextId,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return { ok: true, savedAt: data.savedAt };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch (_) {
    return null;
  }
}

export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch (_) {
    return false;
  }
}

export function applySave(state, data) {
  const p = state.player;
  state.minutes = data.minutes;
  state.sim.now = data.simTick / 60;
  state.sim.tick = data.simTick;
  state.cash = data.cash;
  p.health = data.health;
  p.ammo = data.ammo;
  p.weapon = data.weapon || 'fists';
  p.pos.set(data.playerX, 0, data.playerZ);
  p.heading = data.playerHeading;
  p.mesh.position.copy(p.pos);
  p.mesh.rotation.y = p.heading;
  state.wanted = data.wanted;
  state.police.setWanted(data.wanted, 'save load');
  state.missionIndex = data.missionIndex;
  state.missionsDone = (data.missionsDone || []).slice();
  state.tokensCollected = new Set(data.tokensCollected || []);
  state.faresDone = data.faresDone || 0;
  state.racesWon = data.racesWon || 0;
  state.kills = data.kills || 0;
  state.nextId = data.nextId || 1000;
  state.missions.syncFromState();
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { volume: 0.6, sensitivity: 1.0 };
    const s = JSON.parse(raw);
    return {
      volume: typeof s.volume === 'number' ? s.volume : 0.6,
      sensitivity: typeof s.sensitivity === 'number' ? s.sensitivity : 1.0,
    };
  } catch (_) {
    return { volume: 0.6, sensitivity: 1.0 };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {
    // Storage unavailable — settings simply do not persist.
  }
}
