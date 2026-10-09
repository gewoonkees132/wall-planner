// The 3D view (design, part 8; lighting pass): one block per unit as
// instanced meshes, stacked dry, the base course and the cap in grey, a
// ground, a person for scale, a low sun from the front left and the sky,
// ambient occlusion in screen space, three preset cameras and free orbit.
// It draws only when the wall or the camera changes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PERSON_HEIGHT, BLOCK } from './block.js';
import { viewCamera, levelling, verticalFov, toScene, PERSON_BOX, MIN_HORIZONTAL_FOV, VIEW_DISTANCE, FARTHEST } from './framing.js';
import { el, key } from './ui/dom.js';
import { PALETTE, inkOn } from './palette.js';
import { PICTOGRAMS, GRID, STROKE } from './pictograms.js';
import { floorBands } from './floor.js';
import { earthUnits, startPick, unitOf, pickKey } from './brushkeys.js';
import {
  SUN, SKY, SKY_COLOUR, BOUNCE, EXPOSURE, SHADOW_MAP, SHADOW_SOFT,
  AO_RADIUS, AO_THICKNESS, AO_SCALE, airFor, sunDirection, shadowFrame,
} from './light.js';

const BACKGROUND = PALETTE.view; // the 3D view's air, as the zone around it
const PERSON_GREY = '#bab4ac'; // placeholder: a light clay, so the wall reads first
const EDGE = 0.005; // m: the radius of a block's softened arrises, placeholder; where two blocks meet dry, the two radii make the joint
const EDGE_SEGMENTS = 2; // the steps of that rounding
const ROUGHNESS = 0.92; // pressed earth: matte, placeholder
const GROUND = '#f1ece5'; // placeholder: a light warm ground, lit by sun and sky about the view's air
const FADE_NEAR = 16; // m: the ground fades into the background beyond the street view
const FADE_FAR = 60; // m: and has the background's colour from here on
// A long wall (Kees, 2026-10-08: no maximum length) pushes the fade, the
// ground and the camera's far plane out with the eye, so the whole wall
// stays drawn and stands on ground. Placeholders.
const GROUND_SIZE = 400; // m across, for a wall of the first screen
const NEAR_SHARE = 1 / 2000; // of the eye's distance: the camera's near plane
const VIEWS = Object.freeze(['close', 'garden', 'street']);
const SUN_REACH = 30; // m: how far the sun stands from the wall's middle
const REST = 200; // ms without a change before the ambient occlusion is drawn, placeholder
// A tap on a block (revision 1, part 5): a press that travels under this
// many px and lets go within this time. A longer press orbits. Placeholders.
const TAP_TRAVEL = 6; // px
const TAP_TIME = 500; // ms
// The robot split (part 3.5): the bands lie this far above the ground, their
// pattern repeats this often along them, and each worker's pictogram stands
// this tall, a share of the view's height whatever the distance. Placeholders.
const BAND_LIFT = 0.002; // m
const BAND_PERIOD = 0.2; // m
const CHIP_SIZE = 0.05;
// One tone a worker, from the palette of UX loop 1, and its pictogram.
const WORKER = Object.freeze({
  hand: { tone: PALETTE.paper, icon: 'person' },
  template: { tone: PALETTE.grey, icon: 'template' },
  robot: { tone: PALETTE.ink, icon: 'robot' },
});

// A triangle into position and normal lists, turned to face along n.
function triangle(positions, normals, a, b, c, n) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const [p, q] = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0 ? [c, b] : [b, c];
  positions.push(...a, ...p, ...q);
  normals.push(...n, ...n, ...n);
}

// A cut block, drawn cut: the prism of its polygon, its edges sharp where a
// whole block's are softened. The polygon in plan round the block's centre,
// x along it and y to its left; the scene's z is the plan's -y.
function prismGeometry(points, height) {
  const h = height / 2;
  const positions = [];
  const normals = [];
  const flat = points.map(([x, y]) => [x, -y]);
  const cx = flat.reduce((s, p) => s + p[0], 0) / flat.length;
  const cz = flat.reduce((s, p) => s + p[1], 0) / flat.length;
  const top = flat.map(([x, z]) => [x, h, z]);
  const bottom = flat.map(([x, z]) => [x, -h, z]);
  for (let i = 1; i + 1 < flat.length; i++) {
    triangle(positions, normals, top[0], top[i], top[i + 1], [0, 1, 0]);
    triangle(positions, normals, bottom[0], bottom[i], bottom[i + 1], [0, -1, 0]);
  }
  flat.forEach(([x0, z0], i) => {
    const j = (i + 1) % flat.length;
    const [x1, z1] = flat[j];
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    let n = [(z1 - z0) / len, 0, -(x1 - x0) / len];
    if (n[0] * ((x0 + x1) / 2 - cx) + n[2] * ((z0 + z1) / 2 - cz) < 0) n = n.map((v) => -v);
    triangle(positions, normals, bottom[i], bottom[j], top[j], n);
    triangle(positions, normals, bottom[i], top[j], top[i], n);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

// A cut block's polygon round its centre (cx, cy): its ends from its cut,
// its faces from its depth, back faces in line.
function cutPolygon(u) {
  const right = BLOCK.depth / 2000;
  const left = u.depthMm / 1000 - right;
  const shift = (u.depthMm - BLOCK.depth) / 2000;
  const { xs, ks, xe, ke } = u.cut;
  return [[xs - ks * right, -right], [xe - ke * right, -right], [xe + ke * left, left], [xs + ks * left, left]]
    .map(([x, y]) => [x, y - shift]);
}

// A canvas of the given size, drawn by draw, as a texture in sRGB.
function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A band's pattern: the hand's paper with an ink edge each side, the
// template's grey with a hatch of the paper, the robot's ink.
function bandTexture(by) {
  const texture = canvasTexture(32, (g, n) => {
    g.fillStyle = WORKER[by].tone;
    g.fillRect(0, 0, n, n);
    if (by === 'hand') {
      g.fillStyle = PALETTE.ink;
      g.fillRect(0, 0, n, 2);
      g.fillRect(0, n - 2, n, 2);
    } else if (by === 'template') {
      g.strokeStyle = PALETTE.paper;
      g.lineWidth = 3;
      for (let k = -n; k < 2 * n; k += 8) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + n, n);
        g.stroke();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// A worker's pictogram on a chip of its tone, the mark in the ink or the
// paper, whichever stands out more on it (pictograms.js, palette.js).
function chipTexture(by) {
  return canvasTexture(64, (g, n) => {
    const { tone, icon } = WORKER[by];
    const ink = inkOn(tone);
    g.fillStyle = tone;
    g.fillRect(0, 0, n, n);
    g.strokeStyle = PALETTE.ink;
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, n - 3, n - 3);
    const scale = (n - 12) / GRID;
    g.setTransform(scale, 0, 0, scale, 6, 6);
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = STROKE;
    const { strokes = [], fills = [] } = PICTOGRAMS[icon];
    for (const d of strokes) g.stroke(new Path2D(d));
    for (const d of fills) g.fill(new Path2D(d));
  });
}

// WebGL 2, which three r186 needs; null when the browser does not offer it.
function webgl2(canvas) {
  try {
    return canvas.getContext('webgl2', {
      alpha: false, antialias: true, depth: true, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default',
    });
  } catch {
    return null;
  }
}

// Without WebGL the 3D zone says in one line why it is empty; the rest of
// the page works as before.
function emptyView(root, texts) {
  root.classList.add('no-webgl');
  root.replaceChildren(el('p', { class: 'view-empty', role: 'status' }, texts.view.noWebgl));
  const nothing = () => {};
  return { setWall: nothing, setView: nothing, setNotice: nothing, setBrush: nothing, resize: nothing };
}

export function createView3d(root, options) {
  const canvas = document.createElement('canvas');
  const context = webgl2(canvas);
  if (!context) return emptyView(root, options.texts);
  try {
    return buildView(root, canvas, context, options);
  } catch {
    return emptyView(root, options.texts);
  }
}

// The person for scale: a plain grey figure 1.75 m tall (placeholder),
// standing upright, shoulders along the wall, inside PERSON_BOX.
function makePerson(material) {
  const s = PERSON_HEIGHT / 1.75;
  const parts = [];
  const part = (geometry, x, y, depth = 1) => {
    geometry.scale(1, 1, depth);
    geometry.translate(x * s, y * s, 0);
    parts.push(geometry);
  };
  part(new THREE.CapsuleGeometry(0.06 * s, 0.74 * s, 3, 10), -0.08, 0.43);
  part(new THREE.CapsuleGeometry(0.06 * s, 0.74 * s, 3, 10), 0.08, 0.43);
  part(new THREE.CapsuleGeometry(0.14 * s, 0.42 * s, 3, 14), 0, 1.15, 0.62);
  // The arms hang straight, so the figure stays inside its box.
  const shoulder = Math.min(0.19, PERSON_BOX.halfWidth - 0.04);
  part(new THREE.CapsuleGeometry(0.04 * s, 0.56 * s, 3, 8), -shoulder, 1.14);
  part(new THREE.CapsuleGeometry(0.04 * s, 0.56 * s, 3, 8), shoulder, 1.14);
  part(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 0.1 * s, 10), 0, 1.52);
  part(new THREE.SphereGeometry(0.1 * s, 16, 10), 0, 1.65);
  // One geometry for the whole figure.
  const merged = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const index = [];
  for (const g of parts) {
    const offset = positions.length / 3;
    positions.push(...g.attributes.position.array);
    normals.push(...g.attributes.normal.array);
    for (const i of g.index.array) index.push(i + offset);
    g.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(index);
  const person = new THREE.Mesh(merged, material);
  person.castShadow = true;
  // It takes the wall's shadow too, and so shares its shader with the ground.
  person.receiveShadow = true;
  return person;
}

// The ground: one plain colour; the scene's fog takes it, from FADE_NEAR
// to FADE_FAR, to the background's own colour, so the two meet without a
// line. Fog adds no shader of its own, so the first frame comes sooner.
function makeGround() {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1 }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.001;
  plane.receiveShadow = true;
  return plane;
}

function buildView(root, canvas, context, { texts, onView, onTapUnit }) {
  const stage = el('div', { class: 'view-stage' });
  // A live region that stays on the page, so the notice is announced.
  const notice = el('p', { class: 'view-notice view-overlay', role: 'status' });
  const hint = el('p', { class: 'view-hint view-overlay' }, texts.view.hint);
  // What the keyboard has picked, said for a screen reader: course, block, angle.
  const picked = el('p', { class: 'sr-only', role: 'status' });
  const viewButtons = VIEWS.map((view) => key(view, texts.view.at(texts.view[view], VIEW_DISTANCE[view]), {
    class: 'view-button', 'data-view': view, 'aria-pressed': 'false',
    onclick: () => onView(view),
  }));
  // The view keys sit over the stage's lower left corner (revision 1, part 3),
  // the hint and the notice over its upper left: one left edge for the zone.
  stage.append(canvas, notice, hint, picked, el('div', { class: 'view-buttons', role: 'group', 'aria-label': '3D view' }, viewButtons));
  root.append(stage);

  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Khronos PBR Neutral: a front face in full light keeps its own colour,
  // and what is brighter rolls off instead of clipping.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  // Soft since r182: five taps of the hardware filter, turned per pixel.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The shadows are drawn again only when the wall moves, not the camera.
  renderer.shadowMap.autoUpdate = false;
  canvas.setAttribute('aria-label', texts.view.hint);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BACKGROUND, FADE_NEAR, FADE_FAR);
  // The pick is drawn in a scene of its own, over the wall, after the
  // ambient occlusion, so it neither takes nor gives any.
  const overlay = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, GROUND_SIZE);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 0.5; // placeholder
  controls.maxDistance = FARTHEST; // placeholder: the farthest view
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // never below the ground
  controls.screenSpacePanning = true;

  // The ground is drawn after the wall and the person, so the ground
  // behind them is not shaded first and painted over after.
  const ground = makeGround();
  ground.renderOrder = 2;
  scene.add(ground);

  // The sky lights every face from above and the ground from below; the
  // sun, low from the front left, lights and casts.
  scene.add(new THREE.HemisphereLight(SKY_COLOUR, BOUNCE, SKY));
  const sun = new THREE.DirectionalLight('#ffffff', SUN);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.radius = SHADOW_SOFT;
  scene.add(sun, sun.target);

  const person = makePerson(new THREE.MeshStandardMaterial({ color: PERSON_GREY, roughness: 0.9 }));
  scene.add(person);

  const wallGroup = new THREE.Group();
  scene.add(wallGroup);
  const geometries = new Map();
  const materials = new Map();
  // The robot split: the bands on the ground and their pictograms, drawn
  // again with each wall; one material and one chip per worker.
  const bandGroup = new THREE.Group();
  scene.add(bandGroup);
  // The pictograms are labels: drawn over the scene, after its ambient occlusion, as the keyboard's pick is.
  const chipGroup = new THREE.Group();
  overlay.add(chipGroup);
  const bandMaterials = new Map();
  const chipMaterials = new Map();
  // The bands lie 2 mm over the ground, nearer than the depth buffer always
  // tells apart: they are drawn after it and pulled toward the eye, so the
  // ground never paints over them.
  const bandMaterial = (by) => {
    if (!bandMaterials.has(by)) {
      bandMaterials.set(by, new THREE.MeshStandardMaterial({
        map: bandTexture(by), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }));
    }
    return bandMaterials.get(by);
  };
  const chipMaterial = (by) => {
    if (!chipMaterials.has(by)) {
      chipMaterials.set(by, new THREE.SpriteMaterial({
        map: chipTexture(by), sizeAttenuation: false, depthTest: false, depthWrite: false, fog: false,
      }));
    }
    return chipMaterials.get(by);
  };

  // Each band a strip between its inner and its outer edge, its pattern
  // running along it; its pictogram at its middle, standing on the ground.
  function setBands(wall) {
    for (const child of [...bandGroup.children]) {
      bandGroup.remove(child);
      child.geometry.dispose();
    }
    chipGroup.clear();
    const bands = floorBands(wall);
    for (const band of bands) {
      const positions = [];
      const normals = [];
      const uvs = [];
      let along = 0;
      for (let k = 0; k + 1 < band.inner.length; k++) {
        const a = band.inner[k];
        const b = band.outer[k];
        const c = band.inner[k + 1];
        const d = band.outer[k + 1];
        const step = Math.hypot((c[0] + d[0] - a[0] - b[0]) / 2, (c[1] + d[1] - a[1] - b[1]) / 2);
        if (step < 1e-6 && Math.hypot(c[0] - a[0], c[1] - a[1]) < 1e-6 && Math.hypot(d[0] - b[0], d[1] - b[1]) < 1e-6) continue;
        const u0 = along / BAND_PERIOD;
        along += step;
        const u1 = along / BAND_PERIOD;
        const [pa, pb, pc, pd] = [a, b, c, d].map(([x, y]) => toScene(x, y, BAND_LIFT));
        const before = positions.length;
        triangle(positions, normals, pa, pb, pd, [0, 1, 0]);
        const first = positions.slice(before);
        triangle(positions, normals, pa, pd, pc, [0, 1, 0]);
        const second = positions.slice(before + 9);
        // The texture's coordinates follow each vertex: along the band, and across from the inner edge (0) to the outer (1).
        const uvOf = (p) => (p === pa ? [u0, 0] : p === pb ? [u0, 1] : p === pc ? [u1, 0] : [u1, 1]);
        for (const tri of [first, second]) {
          for (let v = 0; v < 9; v += 3) {
            const at = [tri[v], tri[v + 1], tri[v + 2]];
            const p = [pa, pb, pc, pd].find((q) => q[0] === at[0] && q[1] === at[1] && q[2] === at[2]);
            uvs.push(...uvOf(p));
          }
        }
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const strip = new THREE.Mesh(geometry, bandMaterial(band.by));
      strip.receiveShadow = true;
      strip.renderOrder = 3;
      bandGroup.add(strip);
      const chip = new THREE.Sprite(chipMaterial(band.by));
      // The chip hangs from the middle of its band toward the eye, so it never stands over the wall's foot.
      chip.center.set(0.5, 1);
      chip.scale.set(CHIP_SIZE, CHIP_SIZE, 1);
      chip.renderOrder = 4;
      chip.position.set(...toScene(band.mark[0], band.mark[1], BAND_LIFT));
      chip.userData = { rank: { hand: 0, template: 1, robot: 2 }[band.by], length: band.to - band.from };
      chipGroup.add(chip);
    }
    // What the bands are, for a reader of the page that cannot see the canvas: by and stretch, in m along the line.
    canvas.dataset.bands = bands.map((b) => `${b.by}:${b.from.toFixed(2)}-${b.to.toFixed(2)}`).join(';');
  }

  // Ambient occlusion over a multisampled frame, then tone mapping and
  // sRGB in one last pass (three.js manual, "Color management"). Without
  // a float colour buffer the renderer draws straight to the canvas.
  let composer = null;
  let occlusion = null;
  if (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    occlusion = new GTAOPass(scene, camera, 1, 1, undefined, {
      radius: AO_RADIUS, thickness: AO_THICKNESS, scale: AO_SCALE, samples: 16,
    }, { radius: 4 });
    composer.addPass(occlusion);
    const marks = new RenderPass(overlay, camera);
    marks.clear = false;
    composer.addPass(marks);
    composer.addPass(new OutputPass());
  }
  // The ambient occlusion is drawn only when the view rests. While the
  // camera or the wall moves, and for the first wall, the frame is drawn
  // straight to the canvas, with the sun, its shadows and the tone mapping;
  // once nothing has moved for REST ms, one frame with the occlusion
  // follows. Under software drawing (a session's measurement) the
  // occlusion took about 300 ms more for the first wall and an orbit ran
  // at 8 frames a second with it, 73 without.
  let moving = true; // until the first wall is up
  let restTimer = null;
  let composedAir = null; // which air is set: the one for the composer or not
  function rest() {
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      moving = false;
      requestDraw();
    }, REST);
  }
  function stir() {
    moving = true;
    rest();
  }
  // The air, cleared and fogged. Straight to the canvas it is neither tone
  // mapped nor fogged after, so it is the zone's colour; through the
  // composer it is tone mapped with the rest, so it is set to the colour
  // Neutral maps onto the zone's.
  const plainAir = new THREE.Color(BACKGROUND);
  const mappedAir = new THREE.Color().setRGB(...airFor(BACKGROUND));
  function setAir(throughComposer) {
    if (composedAir === throughComposer) return;
    composedAir = throughComposer;
    const air = throughComposer ? mappedAir : plainAir;
    scene.background = air;
    scene.fog.color.copy(air);
  }
  setAir(false);

  // A block with softened arrises, its full size: dry blocks touch, and
  // the joint is where two roundings meet. Each block casts its own
  // shadow: three.js tests a caster's layers against the view camera, not
  // the shadow camera, so a stand-in on a layer of its own casts nothing.
  function geometryFor(length, height, depth) {
    const key = `${length}|${height}|${depth}`;
    if (!geometries.has(key)) {
      geometries.set(key, new RoundedBoxGeometry(Math.max(0.01, length), Math.max(0.01, height), depth, EDGE_SEGMENTS, EDGE));
    }
    return geometries.get(key);
  }

  function materialFor(colour) {
    if (!materials.has(colour)) materials.set(colour, new THREE.MeshStandardMaterial({ color: colour, roughness: ROUGHNESS }));
    return materials.get(colour);
  }

  let frame = null;
  let currentView = 'garden';
  let movedByHand = false;
  let pending = false;
  let width = 1;
  let height = 1;
  let across = MIN_HORIZONTAL_FOV; // degrees, set for each view (framing.js)

  // No chip lies on another on the canvas: as the camera has them, the
  // robot's are placed first, then the template's, then the longer bands';
  // one that would meet a chip already placed is not drawn.
  const chipAt = new THREE.Vector3();
  function declutter() {
    const chips = chipGroup.children;
    if (chips.length < 2) return;
    const m = camera.projectionMatrix.elements;
    const across = CHIP_SIZE * Math.abs(m[0]);
    const up = CHIP_SIZE * Math.abs(m[5]);
    const placed = [];
    for (const chip of chips.slice().sort((a, b) => b.userData.rank - a.userData.rank || b.userData.length - a.userData.length)) {
      chipAt.copy(chip.position).project(camera);
      chip.visible = placed.every((p) => Math.abs(p.x - chipAt.x) >= across || Math.abs(p.y - chipAt.y) >= up);
      if (chip.visible) placed.push({ x: chipAt.x, y: chipAt.y });
    }
  }

  function draw() {
    pending = false;
    declutter();
    const throughComposer = Boolean(composer && frame && !moving);
    setAir(throughComposer);
    if (throughComposer) {
      composer.render();
      return;
    }
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.render(overlay, camera);
  }

  function requestDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  }

  // Verticals stay vertical: the camera looks level and the frame shifts,
  // unless it looks steeply down (framing.js).
  // How far the wall reaches from the point the camera looks at, in m.
  let wallReach = 0;

  // The fade, the ground and the far plane follow the eye's distance, so a
  // wall of any length is drawn whole, on ground, before the fade.
  function deepen() {
    const away = camera.position.distanceTo(controls.target) + wallReach;
    scene.fog.near = Math.max(FADE_NEAR, 1.5 * away);
    scene.fog.far = Math.max(FADE_FAR, 4 * away);
    camera.near = Math.max(0.05, away * NEAR_SHARE);
    camera.far = Math.max(GROUND_SIZE, 2 * scene.fog.far);
    const size = Math.max(1, (2 * scene.fog.far) / GROUND_SIZE);
    ground.scale.set(size, size, 1);
    ground.position.set(controls.target.x, ground.position.y, controls.target.z);
  }

  function level() {
    deepen();
    const { yaw, pitch, shift } = levelling(camera.position.toArray(), controls.target.toArray());
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.fov = verticalFov(width / height, across);
    const half = Math.tan((camera.fov * Math.PI) / 360);
    camera.setViewOffset(width, height, 0, (-shift * height) / (2 * half), width, height);
  }

  // While a hand orbits the view, no rest comes; it comes after the hand lets go.
  controls.addEventListener('start', () => {
    movedByHand = true;
    moving = true;
    clearTimeout(restTimer);
  });
  controls.addEventListener('end', rest);

  // A tap on a block of the wall: found by a ray through the instanced
  // meshes, which carry their units in instance order.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let press = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.id) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const held = performance.now() - press.t;
    press = null;
    if (moved > TAP_TRAVEL || held > TAP_TIME || !onTapUnit) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const meshes = [...pool.values()].filter((mesh) => mesh.parent);
    const hit = raycaster.intersectObjects(meshes, false).find((h) => h.instanceId !== undefined && h.object.userData.units);
    if (hit) onTapUnit(hit.object.userData.units[hit.instanceId]);
  });
  canvas.addEventListener('pointercancel', () => { press = null; });

  // The brush from the keyboard (brushkeys.js): the view takes focus, the
  // arrow keys move a pick over the earth blocks, Enter or Space turns the
  // picked block as a tap does. The pick is drawn as a green box over the
  // block, and said in words, while the keyboard holds the view.
  let blocks = []; // the earth units of the wall drawn
  let pick = null; // { course, index }
  let brush = false; // the wall can be turned (the blocks vary by turn)
  let keyboard = false; // the keyboard holds the view
  const mark = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: PALETTE.green, transparent: true, opacity: 0.75, depthTest: false, fog: false }),
  );
  mark.renderOrder = 5;
  mark.visible = false;
  overlay.add(mark);

  function showPick() {
    const unit = brush && keyboard ? unitOf(blocks, pick) : null;
    mark.visible = Boolean(unit);
    if (unit) {
      rotation.setFromAxisAngle(up, unit.bearing + (unit.rotationDeg * Math.PI) / 180);
      mark.quaternion.copy(rotation);
      mark.position.set(...toScene(unit.cx, unit.cy, unit.z));
      mark.scale.set(unit.length, unit.height, unit.depthMm / 1000 + 0.02);
      const words = texts.turn.block(unit.course, unit.index, unit.rotationDeg);
      if (picked.textContent !== words) picked.textContent = words;
    } else if (picked.textContent) {
      picked.textContent = '';
    }
    hint.textContent = brush && keyboard ? texts.view.keysHint : texts.view.hint;
    requestDraw();
  }

  canvas.addEventListener('focus', () => {
    keyboard = canvas.matches(':focus-visible');
    if (!unitOf(blocks, pick)) pick = startPick(blocks);
    showPick();
  });
  canvas.addEventListener('blur', () => {
    keyboard = false;
    showPick();
  });
  canvas.addEventListener('keydown', (event) => {
    if (!brush || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!unitOf(blocks, pick)) pick = startPick(blocks);
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      const unit = unitOf(blocks, pick);
      if (!unit || !onTapUnit) return;
      event.preventDefault();
      keyboard = true;
      onTapUnit(unit);
      return;
    }
    const next = pickKey({ units: blocks, picked: pick, key: event.key });
    if (!next) return;
    event.preventDefault();
    keyboard = true;
    pick = next.picked;
    showPick();
  });

  // The view takes focus only while the blocks can be turned: a stop that does nothing is a trap.
  function setBrush(on) {
    brush = Boolean(on);
    canvas.setAttribute('tabindex', brush ? '0' : '-1');
    if (!brush) keyboard = false;
    showPick();
  }
  controls.addEventListener('change', () => {
    if (controls.target.y < 0) controls.target.y = 0;
    if (camera.position.y < 0.05) camera.position.y = 0.05;
    level();
    requestDraw();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer.shadowMap.needsUpdate = true;
    requestDraw();
  });

  // Pass 6 (part 14.1): each view frames the whole wall and the person on
  // the canvas as it is; its key says how far back the eye stands.
  function placeCamera(view) {
    if (!frame) return;
    const shot = viewCamera(frame, view, width / height);
    across = shot.across;
    camera.position.set(...shot.eye);
    controls.target.set(...shot.target);
    controls.update();
    level();
  }

  function nameKeys() {
    if (!frame) return;
    for (const button of viewButtons) {
      const view = button.dataset.view;
      const words = texts.view.at(texts.view[view], viewCamera(frame, view, width / height).distance);
      const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (text && text.textContent !== words) text.textContent = words;
    }
  }

  // The sun from the front left; its shadow camera holds the wall and the
  // person and nothing more, so each texel of the map covers as little as
  // it can (three.js manual, "Shadows"). The ambient occlusion keeps to
  // the same room.
  const clipBox = new THREE.Box3();
  function placeSunAndPerson(units) {
    const { middle, normal, tangent, person: standing, height: wallHeight } = frame;
    const [dx, dy, dz] = sunDirection(normal, tangent);
    const target = new THREE.Vector3(...toScene(middle[0], middle[1], wallHeight / 2));
    sun.target.position.copy(target);
    // The sun stands beyond the whole wall, so every part of it casts its shadow (pass 6; a long wall, no maximum length).
    const reach = Math.max(SUN_REACH, 1.5 * wallReach + 10);
    sun.position.copy(target).add(new THREE.Vector3(...toScene(dx * reach, dy * reach, dz * reach)));
    const points = [];
    for (const u of units) {
      points.push(toScene(u.cx, u.cy, u.z - u.height / 2), toScene(u.cx, u.cy, u.z + u.height / 2));
    }
    const { halfWidth, halfDepth } = PERSON_BOX;
    for (const a of [-halfWidth, halfWidth]) {
      for (const b of [-halfDepth, halfDepth]) {
        for (const z of [0, PERSON_HEIGHT]) {
          points.push(toScene(standing[0] + tangent[0] * a + normal[0] * b, standing[1] + tangent[1] * a + normal[1] * b, z));
        }
      }
    }
    // Half a block's diagonal round each centre.
    const box = shadowFrame(points, sun.position.toArray(), target.toArray(), 0.16, wallHeight * 4 + 2);
    const cam = sun.shadow.camera;
    Object.assign(cam, box);
    cam.updateProjectionMatrix();
    // The offsets that keep a face from shading itself, scaled to a texel.
    const texel = Math.max(box.right - box.left, box.top - box.bottom) / SHADOW_MAP;
    sun.shadow.normalBias = texel * 1.5;
    sun.shadow.bias = -texel / (box.far - box.near);
    person.position.set(...toScene(standing[0], standing[1], 0));
    person.rotation.y = Math.atan2(tangent[1], tangent[0]);
    if (occlusion) {
      clipBox.setFromPoints(points.map((p) => new THREE.Vector3(...p)));
      clipBox.expandByScalar(AO_RADIUS * 2);
      occlusion.setSceneClipBox(clipBox);
    }
  }

  // The meshes are kept and filled again: one per kind of block, with room
  // to grow, so a drag rewrites matrices instead of making new meshes.
  const pool = new Map();
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const at = new THREE.Vector3();

  function instanced(current, geometry, material, count) {
    if (current && current.instanceMatrix.count >= count) {
      current.count = count;
      return current;
    }
    if (current) {
      wallGroup.remove(current);
      current.dispose();
    }
    const mesh = new THREE.InstancedMesh(geometry, material, Math.ceil(count * 1.25) + 4);
    mesh.count = count;
    mesh.frustumCulled = false;
    return mesh;
  }

  // A cut block's shape, made once for every block cut alike.
  function cutGeometryFor(u, key) {
    if (!geometries.has(key)) geometries.set(key, prismGeometry(cutPolygon(u), u.height));
    return geometries.get(key);
  }

  function setWall(wall, wallFrame) {
    stir();
    const groups = new Map();
    for (const u of wall.units) {
      // The robot split: blocks cut alike, to a tenth of a millimetre, share a shape.
      const key = u.cut
        ? `cut|${u.colour}|${u.height}|${cutPolygon(u).map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')}`
        : `${u.colour}|${u.length}|${u.height}|${u.depthMm}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(u);
    }
    for (const [key, mesh] of pool) {
      if (!groups.has(key) && mesh.parent) wallGroup.remove(mesh);
    }
    for (const [key, units] of groups) {
      const u0 = units[0];
      const depth = u0.depthMm / 1000;
      const kept = pool.get(key);
      const shape = u0.cut ? cutGeometryFor(u0, key) : geometryFor(u0.length, u0.height, depth);
      const mesh = instanced(kept, shape, materialFor(u0.colour), units.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.parent) wallGroup.add(mesh);
      mesh.userData.units = units;
      pool.set(key, mesh);
      units.forEach((u, i) => {
        rotation.setFromAxisAngle(up, u.bearing + (u.rotationDeg * Math.PI) / 180);
        matrix.compose(at.set(...toScene(u.cx, u.cy, u.z)), rotation, one);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    frame = wallFrame;
    const [mx, my] = frame.middle;
    wallReach = Math.max(...frame.outline.map(([x, y]) => Math.hypot(x - mx, y - my)), 0);
    setBands(wall);
    placeSunAndPerson(wall.units);
    renderer.shadowMap.needsUpdate = true;
    if (!movedByHand) placeCamera(currentView);
    nameKeys();
    blocks = earthUnits(wall.units);
    if (!unitOf(blocks, pick)) pick = startPick(blocks);
    showPick();
    requestDraw();
  }

  function setView(view) {
    currentView = VIEWS.includes(view) ? view : 'garden';
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === currentView));
    }
    movedByHand = false;
    placeCamera(currentView);
    requestDraw();
  }

  // true for the last wall that fits; a text of its own (pass 4: no wall fits yet); false for none.
  function setNotice(show) {
    const text = typeof show === 'string' ? show : show ? texts.view.lastFits : '';
    if (notice.textContent !== text) notice.textContent = text;
  }

  // Sized once the stage has its room, and again only when that changes:
  // each new size makes the browser allocate the drawing buffers anew.
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w < 2 || h < 2 || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(width, height, false);
    if (composer) composer.setSize(width, height);
    camera.aspect = width / height;
    if (movedByHand) level();
    else placeCamera(currentView);
    nameKeys();
    requestDraw();
  }

  new ResizeObserver(resize).observe(stage);
  resize();

  return { setWall, setView, setNotice, setBrush, resize };
}
