// minimap.js — canvas minimap: roads, sea, player, police, rivals, marker.
// Blip blinking is keyed to sim time. Drawn every tick from sim state only.

const ROAD_XS = [-198, -120, -60, 0, 60, 120, 180];
const ROAD_ZS = [-180, -120, -60, 0, 60, 120, 180];

export class Minimap {
  constructor(state) {
    this.state = state;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.size = 168;
    this.half = 240;
  }

  _toMap(x, z) {
    const s = this.size / (this.half * 2);
    return [this.size / 2 + x * s, this.size / 2 + z * s];
  }

  draw(simNow) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const st = this.state;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#e6d9b8';
    ctx.fillRect(0, 0, S, S);
    // Sea (west edge).
    ctx.fillStyle = '#1e6fa8';
    ctx.fillRect(0, 0, 14, S);
    // Roads.
    ctx.strokeStyle = '#3c3f45';
    ctx.lineWidth = 4;
    for (const x of ROAD_XS) {
      const [mx] = this._toMap(x, 0);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, S);
      ctx.stroke();
    }
    for (const z of ROAD_ZS) {
      const [, mz] = this._toMap(0, z);
      ctx.beginPath();
      ctx.moveTo(0, mz);
      ctx.lineTo(S, mz);
      ctx.stroke();
    }
    // Marina water.
    ctx.fillStyle = '#2a7fc2';
    const [bx, bz] = this._toMap(150, 150);
    ctx.fillRect(bx - 20, bz - 15, 40, 30);
    // Lighthouse.
    ctx.fillStyle = '#d94f3d';
    const [lx, lz] = this._toMap(-198, -228);
    ctx.beginPath();
    ctx.arc(lx, lz, 4, 0, Math.PI * 2);
    ctx.fill();
    // Mission marker: pulsing ring on sim time.
    if (st.marker) {
      const [mx, mz] = this._toMap(st.marker.x, st.marker.z);
      const r = 5 + Math.sin(simNow * 3) * 1.5;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, mz, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(mx, mz, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sun tokens.
    ctx.fillStyle = '#ffb703';
    for (const t of st.city.tokens) {
      if (t.taken) continue;
      const [tx, tz] = this._toMap(t.x, t.z);
      ctx.fillRect(tx - 1.5, tz - 1.5, 3, 3);
    }
    // Police blips (blink on sim time).
    if (Math.floor(simNow * 2) % 2 === 0) {
      ctx.fillStyle = '#2255ff';
      for (const c of st.police.cars) {
        const [cx, cz] = this._toMap(c.pos.x, c.pos.z);
        ctx.beginPath();
        ctx.arc(cx, cz, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Rivals.
    ctx.fillStyle = '#8a5a9e';
    for (const r of st.combat.rivals) {
      const [rx, rz] = this._toMap(r.pos.x, r.pos.z);
      ctx.beginPath();
      ctx.arc(rx, rz, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    const [px, pz] = this._toMap(st.player.pos.x, st.player.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-st.player.heading);
    ctx.fillStyle = '#d94f3d';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Border.
    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
  }
}
