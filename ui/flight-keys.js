'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.FlightKeys = value;
})(globalThis, function () {
  const codes = new Set(['KeyW','KeyS','ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
  const clamp = n => Math.max(0, Math.min(127, n));
  return class FlightKeys {
    constructor() { this.reset(); }
    reset() { this.keys = new Set(); this.dirty = new Set(); }
    accepts(code) { return codes.has(code); }
    press(code) {
      if (!codes.has(code)) return false;
      this.keys.add(code); this.markAxis(code); return true;
    }
    release(code) {
      if (!this.keys.delete(code)) return false;
      this.markAxis(code); return true;
    }
    markAxis(code) {
      if (code === 'ArrowLeft' || code === 'ArrowRight') this.dirty.add('yaw');
      if (code === 'ArrowUp' || code === 'ArrowDown') this.dirty.add('pitch');
    }
    sample(throttle, {ramp=true, strength=32, invertYaw=false, invertPitch=false}={}) {
      const output = {};
      if (ramp && (this.keys.has('KeyW') || this.keys.has('KeyS')))
        output.throttle = clamp(throttle + 2 * (Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'))));
      // Captures suggest left = increasing yaw and forward = decreasing pitch.
      for (const [axis, positive, negative, invert] of [
        ['yaw','ArrowLeft','ArrowRight',invertYaw],
        ['pitch','ArrowDown','ArrowUp',invertPitch]
      ]) {
        if (this.dirty.has(axis)) {
          const direction = Number(this.keys.has(positive)) - Number(this.keys.has(negative));
          output[axis] = clamp(63 + direction * strength * (invert ? -1 : 1));
        }
      }
      this.dirty.clear();
      return output;
    }
  };
});
