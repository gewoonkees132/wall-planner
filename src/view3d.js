// The 3D view (design, part 8): one box per unit as instanced meshes, the
// base course and the cap in grey, a ground, a person for scale, a sun
// from the front left, three preset cameras and free orbit. It draws only
// when the wall or the camera changes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PERSON_HEIGHT, PERSON_OFFSET } from './block.js';
import { presetCamera, levelling, horizontalFov, verticalFov, toScene, PERSON_BOX, MIN_HORIZONTAL_FOV } from './framing.js';
import { el, key } from './ui/dom.js';
import { PALETTE } from './palette.js';
import { earthUnits, startPick, unitOf, pickKey } from './brushkeys.js';

const BACKGROUND = PALETTE.view; // the 3D view's air, as the zone around it
const PERSON_GREY = '#bab4ac'; // placeholder: a light clay, so the wall reads first
const JOINT_DARK = '#3d352e'; // placeholder: what shows in a joint between two blocks
const JOINT = 0.006; // m: blocks are drawn this much shorter and lower, so the joints read; the plan is not changed
const EDGE = 0.007; // m: the radius of a block's softened edges, placeholder
const CORE_INSET = 0.012; // m: the dark core behind the joints stays this far inside each face
const CORE_REACH = 0.012; // m: and reaches this far into the room of its neighbours
// A sun from the front left: this far round from the front toward the
// wall's far end, and this high (placeholders). Front faces then show
// their own colour; sides and shadows show depth and turn.
const SUN_AZIMUTH = (55 * Math.PI) / 180;
const SUN_ELEVATION = (32 * Math.PI) / 180;
const SUN = 2.66; // intensity, so that sun and sky light a front face to its own colour
const SKY = 2.15; // intensity of the sky light that fills the shadows
const SKY_GROUND = '#d8d4cc'; // the light the ground sends back up, placeholder
const GROUND = '#e6e1da'; // placeholder: a light warm ground, lit by sun and sky about the view's air
const FADE_NEAR = 16; // m: the ground fades into the background beyond the street view
const FADE_FAR = 60; // m: and has the background's colour from here on
const VIEWS = Object.freeze(['close', 'garden', 'street']);
const CASTERS = 1; // the layer of the plain boxes that cast the blocks' shadows
// A tap on a block (revision 1, part 5): a press that travels under this
// many px and lets go within this time. A longer press orbits. Placeholders.
const TAP_TRAVEL = 6; // px
const TAP_TIME = 500; // ms

// WebGL 2, which three r175 needs; null when the browser does not offer it.
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
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: GROUND }));
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
  const viewButtons = VIEWS.map((view) => key(view, texts.view[view], {
    class: 'view-button', 'data-view': view, 'aria-pressed': 'false',
    onclick: () => onView(view),
  }));
  // The view keys sit over the stage's lower left corner (revision 1, part 3),
  // the hint and the notice over its upper left: one left edge for the zone.
  stage.append(canvas, notice, hint, picked, el('div', { class: 'view-buttons', role: 'group', 'aria-label': '3D view' }, viewButtons));
  root.append(stage);

  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The shadows are drawn again only when the wall moves, not the camera.
  renderer.shadowMap.autoUpdate = false;
  canvas.setAttribute('aria-label', texts.view.hint);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.Fog(BACKGROUND, FADE_NEAR, FADE_FAR);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 0.5; // placeholder
  controls.maxDistance = 30; // placeholder
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // never below the ground
  controls.screenSpacePanning = true;

  // The ground is drawn after the wall and the person, so the ground
  // behind them is not shaded first and painted over after.
  const ground = makeGround();
  ground.renderOrder = 2;
  scene.add(ground);

  // A sky light fills the shadows; a sun from the front left casts them.
  scene.add(new THREE.HemisphereLight('#ffffff', SKY_GROUND, SKY));
  const sun = new THREE.DirectionalLight('#ffffff', SUN);
  sun.castShadow = true;
  // A shadow map a phone can carry; soft shadows hide its texels.
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.012;
  // The shadow camera also sees layer 1, where plain boxes stand in for
  // the rounded blocks: the same shadow, drawn for a fraction of the cost.
  sun.shadow.camera.layers.enable(CASTERS);
  scene.add(sun, sun.target);

  const person = makePerson(new THREE.MeshLambertMaterial({ color: PERSON_GREY }));
  scene.add(person);

  const wallGroup = new THREE.Group();
  scene.add(wallGroup);
  const geometries = new Map();
  const materials = new Map();
  const coreGeometry = new THREE.BoxGeometry(1, 1, 1);
  const coreMaterial = new THREE.MeshLambertMaterial({ color: JOINT_DARK });

  // A block with softened edges, drawn a joint shorter and lower than its
  // room, and the plain box that casts its shadow.
  function geometryFor(length, height, depth, plain = false) {
    const key = `${length}|${height}|${depth}|${plain}`;
    if (!geometries.has(key)) {
      const l = Math.max(0.01, length - JOINT);
      const h = Math.max(0.01, height - JOINT);
      geometries.set(key, plain ? new THREE.BoxGeometry(l, h, depth) : new RoundedBoxGeometry(l, h, depth, 1, EDGE));
    }
    return geometries.get(key);
  }

  function materialFor(colour) {
    if (!materials.has(colour)) materials.set(colour, new THREE.MeshLambertMaterial({ color: colour }));
    return materials.get(colour);
  }

  let frame = null;
  let currentView = 'garden';
  let movedByHand = false;
  let pending = false;
  let width = 1;
  let height = 1;
  let across = MIN_HORIZONTAL_FOV; // degrees, set for each wall (framing.js)

  function draw() {
    pending = false;
    renderer.render(scene, camera);
  }

  function requestDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  }

  // Verticals stay vertical: the camera looks level and the frame shifts,
  // unless it looks steeply down (framing.js).
  function level() {
    const { yaw, pitch, shift } = levelling(camera.position.toArray(), controls.target.toArray());
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.fov = verticalFov(width / height, across);
    const half = Math.tan((camera.fov * Math.PI) / 360);
    camera.setViewOffset(width, height, 0, (-shift * height) / (2 * half), width, height);
  }

  controls.addEventListener('start', () => { movedByHand = true; });

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
    const meshes = [...pool.values()].map((entry) => entry.mesh).filter((mesh) => mesh.parent);
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
    new THREE.MeshBasicMaterial({ color: PALETTE.green, transparent: true, opacity: 0.75, depthTest: false }),
  );
  mark.renderOrder = 5;
  mark.visible = false;
  scene.add(mark);

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

  function placeCamera(view) {
    if (!frame) return;
    const { eye, target } = presetCamera(frame, view);
    camera.position.set(...eye);
    controls.target.set(...target);
    controls.update();
    level();
  }

  function placeSunAndPerson() {
    const { middle, normal, tangent, person: standing, height: wallHeight, span } = frame;
    // From the front left, as seen by a person facing the front of the wall.
    const hx = normal[0] * Math.cos(SUN_AZIMUTH) + tangent[0] * Math.sin(SUN_AZIMUTH);
    const hy = normal[1] * Math.cos(SUN_AZIMUTH) + tangent[1] * Math.sin(SUN_AZIMUTH);
    const reach = 30;
    const target = new THREE.Vector3(...toScene(middle[0], middle[1], wallHeight / 2));
    sun.target.position.copy(target);
    sun.position.copy(target).add(new THREE.Vector3(...toScene(
      hx * Math.cos(SUN_ELEVATION) * reach, hy * Math.cos(SUN_ELEVATION) * reach, Math.sin(SUN_ELEVATION) * reach,
    )));
    const half = Math.max(span, wallHeight) / 2 + PERSON_OFFSET + 1.5;
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = reach * 2;
    cam.updateProjectionMatrix();
    person.position.set(...toScene(standing[0], standing[1], 0));
    person.rotation.y = Math.atan2(tangent[1], tangent[0]);
  }

  // The meshes are kept and filled again: one per kind of block, with room
  // to grow, so a drag rewrites matrices instead of making new meshes.
  const pool = new Map();
  let cores = null;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const size = new THREE.Vector3();
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

  function setWall(wall, wallFrame) {
    const groups = new Map();
    for (const u of wall.units) {
      const key = `${u.colour}|${u.length}|${u.height}|${u.depthMm}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(u);
    }
    for (const [key, { mesh, caster }] of pool) {
      if (!groups.has(key) && mesh.parent) wallGroup.remove(mesh, caster);
    }
    for (const [key, units] of groups) {
      const u0 = units[0];
      const depth = u0.depthMm / 1000;
      const kept = pool.get(key);
      const mesh = instanced(kept && kept.mesh, geometryFor(u0.length, u0.height, depth), materialFor(u0.colour), units.length);
      let caster = kept && kept.caster;
      if (!kept || kept.mesh !== mesh) {
        if (caster) wallGroup.remove(caster);
        // The caster shares the blocks' matrices, so it moves with them.
        caster = new THREE.InstancedMesh(geometryFor(u0.length, u0.height, depth, true), coreMaterial, 1);
        caster.instanceMatrix = mesh.instanceMatrix;
        caster.layers.set(CASTERS);
        caster.castShadow = true;
        caster.frustumCulled = false;
        mesh.receiveShadow = true;
      }
      caster.count = units.length;
      if (!mesh.parent) wallGroup.add(mesh, caster);
      mesh.userData.units = units;
      pool.set(key, { mesh, caster });
      units.forEach((u, i) => {
        rotation.setFromAxisAngle(up, u.bearing + (u.rotationDeg * Math.PI) / 180);
        matrix.compose(at.set(...toScene(u.cx, u.cy, u.z)), rotation, one);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    // The dark core behind the joints, along the line and inside the faces:
    // it reaches into the neighbours' room, so a joint never shows the sky
    // through it, and stops inside the wall's ends and below the cap's top.
    cores = instanced(cores, coreGeometry, coreMaterial, wall.units.length);
    if (!cores.parent) {
      cores.receiveShadow = true;
      // After the blocks, so only the joints are shaded.
      cores.renderOrder = 1;
      wallGroup.add(cores);
    }
    wall.units.forEach((u, i) => {
      const first = u.index === 1;
      const last = i + 1 === wall.units.length || wall.units[i + 1].course !== u.course;
      const from = -u.span / 2 + (first ? JOINT : -CORE_REACH);
      const to = u.span / 2 - (last ? JOINT : -CORE_REACH);
      const top = u.kind === 'cap' ? u.height / 2 - JOINT : u.height / 2;
      const bottom = -u.height / 2;
      const along = (from + to) / 2;
      rotation.setFromAxisAngle(up, u.bearing);
      size.set(to - from, top - bottom, Math.max(0.01, u.depthMm / 1000 - 2 * CORE_INSET));
      at.set(...toScene(u.cx + Math.cos(u.bearing) * along, u.cy + Math.sin(u.bearing) * along, u.z + (top + bottom) / 2));
      matrix.compose(at, rotation, size);
      cores.setMatrixAt(i, matrix);
    });
    cores.instanceMatrix.needsUpdate = true;
    frame = wallFrame;
    across = horizontalFov(frame);
    placeSunAndPerson();
    renderer.shadowMap.needsUpdate = true;
    if (!movedByHand) placeCamera(currentView);
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

  function setNotice(show) {
    const text = show ? texts.view.lastFits : '';
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
    camera.aspect = width / height;
    level();
    requestDraw();
  }

  new ResizeObserver(resize).observe(stage);
  resize();

  return { setWall, setView, setNotice, setBrush, resize };
}
