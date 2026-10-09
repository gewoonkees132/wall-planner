// The light of the 3D view (lighting pass, docs/specs/configurator-demonstrator-light.md):
// a sun from the front left and a sky, a shadow camera fitted to what
// casts, and Khronos PBR Neutral tone mapping, with its inverse for the
// view's air. Pure: no browser objects, so the numbers can be tested.

import { hexToRgb } from './colour.js';

const DEG = Math.PI / 180;
// The sun stands this far round from the wall's front toward its far end,
// and this high (placeholders): low and from the side, so that a turned
// block lights on one face, shades on the other and casts on its neighbour.
export const SUN_AZIMUTH = 62 * DEG;
export const SUN_ELEVATION = 28 * DEG;
// Intensities, as three.js takes them (physical, not scaled by pi). The sun
// gives about four times what the sky gives a front face, as on a clear
// day; together they light a sunlit front face to its own colour (pi).
export const SUN = 5.0;
export const SKY = 1.35;
export const SKY_COLOUR = '#f2f5fa'; // a pale sky, placeholder
export const BOUNCE = '#cfc6b8'; // what the ground sends back up, placeholder
// Measured, not modelled: three.js's Standard material gives a matte face a
// little less diffuse light than Lambert, so at 1.0 a sunlit front face of
// Pale clay drew #d8c49c for its #e2cda8; at 1.12 it draws #e4cea6 (a
// session's probe, software WebGL, close view, a Depth wall).
export const EXPOSURE = 1.12;

// The shadow map: one square map over the wall and the person, this many
// texels a side, softened this many texels.
export const SHADOW_MAP = 2048;
export const SHADOW_SOFT = 1.6;

// Ambient occlusion in screen space (GTAO): how far a block looks for what
// hides the sky from it, in m, and how strongly. Placeholders.
export const AO_RADIUS = 0.14;
export const AO_THICKNESS = 0.4;
export const AO_SCALE = 1.0;

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// Khronos PBR Neutral, as three.js r186 applies it (tonemapping_pars_fragment).
export function neutral([r, g, b], exposure = EXPOSURE) {
  let c = [r * exposure, g * exposure, b * exposure];
  const x = Math.min(...c);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c = c.map((v) => v - offset);
  const peak = Math.max(...c);
  const start = 0.8 - 0.04;
  if (peak < start) return c;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  c = c.map((v) => (v * newPeak) / peak);
  const g2 = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return c.map((v) => v + (newPeak - v) * g2);
}

// The linear colour that PBR Neutral maps onto the given linear colour:
// found by fixed-point steps, since the curve is close to the identity.
export function unNeutral(target, exposure = EXPOSURE) {
  let c = [...target];
  for (let i = 0; i < 200; i++) {
    const out = neutral(c, exposure);
    c = c.map((v, k) => Math.max(0, v + (target[k] - out[k])));
  }
  return c;
}

// The linear colour to clear and fog with, so that after tone mapping the
// view's air shows exactly the given sRGB colour.
export function airFor(hex) {
  return unNeutral(hexToRgb(hex).map((v) => srgbToLinear(v / 255)));
}

// Toward the sun, in plan (x, y, z up), from the wall's front normal and
// its tangent: round from the front toward the far end, then up.
export function sunDirection(normal, tangent, azimuth = SUN_AZIMUTH, elevation = SUN_ELEVATION) {
  const hx = normal[0] * Math.cos(azimuth) + tangent[0] * Math.sin(azimuth);
  const hy = normal[1] * Math.cos(azimuth) + tangent[1] * Math.sin(azimuth);
  return [hx * Math.cos(elevation), hy * Math.cos(elevation), Math.sin(elevation)];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const n = Math.hypot(...a) || 1;
  return a.map((v) => v / n);
};

// The box of an orthographic shadow camera at eye, looking at target with
// three.js's up (0, 1, 0), that holds every point with the margin around
// it (scene coordinates, y up). Its depth runs on past the farthest point
// by reach, so the ground behind the wall takes the wall's shadow.
export function shadowFrame(points, eye, target, margin, reach) {
  const z = unit(sub(eye, target));
  const x = unit(cross([0, 1, 0], z));
  const y = cross(z, x);
  const box = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity, near: Infinity, far: -Infinity };
  for (const p of points) {
    const v = sub(p, eye);
    const lx = dot(v, x);
    const ly = dot(v, y);
    const depth = -dot(v, z);
    box.left = Math.min(box.left, lx - margin);
    box.right = Math.max(box.right, lx + margin);
    box.bottom = Math.min(box.bottom, ly - margin);
    box.top = Math.max(box.top, ly + margin);
    box.near = Math.min(box.near, depth - margin);
    box.far = Math.max(box.far, depth + margin);
  }
  box.near = Math.max(0.01, box.near);
  box.far += reach;
  return box;
}

// What the sun and the sky give a face with this normal, in plan, sunlit
// or not: the irradiance three.js computes for a Lambert face.
export function irradiance(normal, sun, lit = true) {
  const sky = hexToRgb(SKY_COLOUR).map((v) => srgbToLinear(v / 255) * SKY);
  const ground = hexToRgb(BOUNCE).map((v) => srgbToLinear(v / 255) * SKY);
  const w = 0.5 * normal[2] + 0.5;
  const direct = lit ? Math.max(0, dot(normal, sun)) * SUN : 0;
  return [0, 1, 2].map((k) => ground[k] + (sky[k] - ground[k]) * w + direct);
}
