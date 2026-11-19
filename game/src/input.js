// input.js — keyboard + mouse state, nothing else.
// Pure input capture: no clocks, no randomness. The fixed-timestep loop
// reads this state once per tick. Scripted runs drive it through
// press()/release(), so a deterministic replay needs no real keyboard.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.pointerLocked = false;
    this.onFirstGesture = null;
    this._gestured = false;
    this._canvas = canvas;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._gesture();
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onMouseMove = (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    };
    this._onMouseDown = (e) => {
      this.mouseDown = true;
      this._gesture();
      if (e.button === 0 && this._canvas && !this.pointerLocked) {
        try {
          this._canvas.requestPointerLock();
        } catch (_) {
          // Pointer lock is optional; the game works without it.
        }
      }
    };
    this._onMouseUp = () => {
      this.mouseDown = false;
    };
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this._canvas;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  _gesture() {
    if (!this._gestured) {
      this._gestured = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  down(code) {
    return this.keys.has(code);
  }

  // Test / script hooks: inject a key without a real keyboard event.
  press(code) {
    this.keys.add(code);
    this._gesture();
  }

  release(code) {
    this.keys.delete(code);
  }

  clear() {
    this.keys.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  consumeMouseDX() {
    const d = this.mouseDX;
    this.mouseDX = 0;
    return d;
  }

  consumeMouseDY() {
    const d = this.mouseDY;
    this.mouseDY = 0;
    return d;
  }
}
