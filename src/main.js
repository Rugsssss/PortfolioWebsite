import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import gsap from 'gsap'
import { dressRoom } from './decor.js'

// Extra models placed in the room. Tune these with ?debug in the URL, then paste the values back here.
// modelRotation fixes the model's own orientation; size = longest side in room units.
const PROPS = {
  pc: { url: '/models/gaming-pc.glb', size: 1.35, modelRotation: [0, 0, 0], position: [-0.85, -0.37, -3.3], rotationY: Math.PI }, // under the desk's door end: fans toward the door, glass toward the chair
  controller: { url: '/models/controller.glb', size: 0.45, modelRotation: [0, 0, Math.PI / 2], position: [1.15, 0.12, 2.2], rotationY: 0.3, snap: true }, // coffee table
  spike: { url: '/models/spike.glb', size: 0.5, modelRotation: [0, 0, 0], position: [0.7, 0.12, 1.65], rotationY: 0.4, snap: true }, // coffee table, next to the controller
  mp3: { url: '/models/mp3-player.glb', size: 0.5, modelRotation: [0, 0, 0], position: [3.08, 0.5, -0.29], rotationY: -0.5, snap: true }, // side table by the sofa
  neon: { url: '/models/neon.glb', size: 2.0, modelRotation: [0, 0, 0], position: [-3.85, 2.45, 1.97], rotationY: 0 }, // left wall, above the TV
  pet: { url: '/models/pet.glb', size: 1.3, modelRotation: [0, 0, 0], position: [-0.6, 0, 2.7], rotationY: 0.94, snap: true }, // golden lab napping on the rug, face toward the room
  mug: { url: '/models/mug.glb', size: 0.42, modelRotation: [0, 0, 0], position: [-0.15, 1.09, -2.7], rotationY: 0 }, // desk, right end; USyd logo added in decor.js
}

// Clickable things -> which <dialog> to open. nodes = room node names (from the .glb, dots removed),
// PROPS keys, or decor objects (posterPaper, posterTrigun, sydney, gsoc).
// view = where the camera sits relative to the object's center when zoomed in.
// The first hotspot for a panel is where the nav buttons fly to.
const HOTSPOTS = [
  // action 'monitor' zooms into that screen (decor.screens key) instead of opening the panel
  { label: 'Projects', panel: 'projects', action: 'monitor', screen: 'projects', nodes: ['Cube005_5', 'Cube014_92', 'Cube026_93', 'Cube027_94', 'Cube028_95', 'Cube015_21', 'Plane007_22'], view: [0.8, 1.2, 4.5] },
  { label: 'Gaming PC', panel: 'graphics', nodes: ['pc'], view: [2.2, 1.6, 3.8] },
  { label: 'Gaming', bubble: 'controller-fact', nodes: ['controller'], view: [1.4, 1.4, 1.2] },
  { label: 'TV', action: 'zoom', nodes: ['Cube003_1'], view: [4.2, 0.6, 0.6] }, // zoom = just fly to it, nothing opens
  { label: 'Manga', action: 'zoom', nodes: ['Plane002_106', 'Plane003_107', 'manga'], view: [3.8, 0.6, 1.2] }, // tall shelves + books
  { label: 'My paper', panel: 'research', nodes: ['posterPaper'], view: [0, 0, 3.6] },
  { label: 'About me', panel: 'about', nodes: ['Cube012_19', 'Cube013_18'], view: [4, 3.5, 3.5] }, // sofa
  { label: 'Sydney', panel: 'about', nodes: ['sydney'], view: [3.6, -0.3, 0.4] },
  { label: 'Trigun', bubble: 'trigun-fact', still: true, nodes: ['posterTrigun'], view: [0.4, 0, 3.4] }, // still = no hop
  { label: 'Valorant', bubble: 'spike-fact', nodes: ['spike'], view: [1.6, 1.0, 2.0] },
  { label: 'Play lofi', action: 'music', nodes: ['mp3'], view: [0.25, 2.2, 0.35] }, // near top-down
  { label: 'Neon', action: 'zoom', nodes: ['neon'], view: [5, 0.5, 0] },
  { label: 'Scooby', bubble: 'scooby', nodes: ['pet'], view: [2.2, 1.6, 2.2] }, // bubble = comic speech bubble (id in index.html) instead of a panel
  { label: 'GSoC', panel: 'gsoc', nodes: ['gsoc'], view: [0, 0, 3] },
  { label: 'USyd', panel: 'about', nodes: ['mug'], view: [1.0, 0.9, 1.6] },
  { label: 'Contact', panel: 'contact', nodes: ['Plane001_85'], view: [0.5, 0.8, 6.5] }, // door
  { label: 'Socials', panel: 'contact', action: 'monitor', screen: 'socials', nodes: ['Cube006_6'], view: [0.8, 1.2, 4.5] },
  { label: 'Lights on/off', action: 'toggleDark', nodes: ['Cylinder031_41'] }, // wall lamp beside the door
]

const HOME_TARGET = new THREE.Vector3(-0.5, 1.2, -0.5)
const HOME_DIR = new THREE.Vector3(14, 11, 14).normalize()

// ---------- plain view (no WebGL, ?plain, or the header toggle) ----------
const plainBtn = document.getElementById('plain-toggle')
function setPlain(on) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close())
  document.body.classList.toggle('plain', on)
  plainBtn.textContent = on ? '3D view' : 'Plain view'
}
plainBtn.addEventListener('click', () => setPlain(!document.body.classList.contains('plain')))
const webgl = !!document.createElement('canvas').getContext('webgl2')
if (!webgl || location.search.includes('plain')) setPlain(true)
if (!webgl) plainBtn.hidden = true

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene')
// no antialias: the scene renders into the composer's targets, which skip it anyway
const renderer = new THREE.WebGLRenderer({ canvas })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)) // 2x on retina is ~1.8x the pixels for little visible gain
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.shadowMap.autoUpdate = false // re-rendered every few frames in the loop; only small things move

const scene = new THREE.Scene()
// background: animated shader in decor.js (bloom drops canvas alpha, so it's drawn in-scene)
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture
scene.environmentIntensity = 0.6

const hemi = new THREE.HemisphereLight(0xffffff, 0xa7a9be, 1.2)
const sun = new THREE.DirectionalLight(0xfff4e6, 1.8)
sun.position.set(8, 12, 6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 })
sun.shadow.normalBias = 0.03
// one per wall lamp, just in front of it; short reach so they light their corner, not the whole room
const lampLights = [[1.32, 2.0, -3.2]].map((p) => { // out in the room from the wall lamp by the door; any closer and it blows the lamp itself out
  const l = new THREE.PointLight(0xffb36b, 0, 4, 2)
  l.position.set(...p)
  return l
})
scene.add(hemi, sun, ...lampLights)

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.enablePan = false
controls.minDistance = 2
controls.maxDistance = 45
controls.maxPolarAngle = Math.PI / 2.1
controls.minAzimuthAngle = 0.08 // room is open toward +x/+z; stop short of edge-on so the backs of the walls never show
controls.maxAzimuthAngle = Math.PI / 2 - 0.08

function homePosition() {
  // back off further on portrait screens so the whole room fits
  const dist = 22 * Math.max(1, 1.1 / camera.aspect)
  return HOME_TARGET.clone().addScaledVector(HOME_DIR, dist)
}

// Bloom only catches really bright things (LEDs, screen, fans); the threshold drops at night.
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.5, 3.2)
composer.addPass(bloom)
composer.addPass(new OutputPass())

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
resize()
addEventListener('resize', resize)
camera.position.copy(homePosition())
controls.target.copy(HOME_TARGET)

// ---------- loading ----------
const manager = new THREE.LoadingManager()
manager.onProgress = (_, loaded, total) => {
  const pct = `${Math.round((loaded / total) * 100)}%`
  document.getElementById('progress').textContent = pct
  document.getElementById('bar').style.width = pct
}
manager.onLoad = () => document.getElementById('loader').classList.add('done')
const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder)

// Wrap a model so `size` and `position` mean "longest side" and "bottom-center on the surface".
function placeProp(wrapper, model, cfg) {
  model.position.set(0, 0, 0)
  model.scale.setScalar(1)
  model.rotation.set(...cfg.modelRotation)
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const s = cfg.size / Math.max(size.x, size.y, size.z)
  const center = box.getCenter(new THREE.Vector3())
  model.scale.setScalar(s)
  model.position.set(-center.x * s, -box.min.y * s, -center.z * s)
  wrapper.position.set(...cfg.position)
  wrapper.rotation.y = cfg.rotationY
  if (cfg.snap) wrapper.position.y = surfaceUnder(wrapper)
}

// Average height of the room surface under an object's footprint (centre + 4 corners), so props
// sit on the lumpy bed sheet instead of floating at a fixed height.
const down = new THREE.Raycaster()
function surfaceUnder(obj) {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj)
  const c = box.getCenter(new THREE.Vector3())
  const hx = (box.max.x - box.min.x) * 0.3
  const hz = (box.max.z - box.min.z) * 0.3
  const heights = [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]].map(([dx, dz]) => {
    down.set(new THREE.Vector3(c.x + dx, 5, c.z + dz), new THREE.Vector3(0, -1, 0))
    return down.intersectObject(room.scene, true).find((h) => h.point.y < 3)?.point.y // skip the wall rims up top
  }).filter((y) => y !== undefined)
  return heights.length ? heights.reduce((a, b) => a + b) / heights.length : obj.position.y
}

const [room, ...props] = await Promise.all([
  loader.loadAsync('/models/room.glb'),
  ...Object.values(PROPS).map((p) => loader.loadAsync(p.url)),
])
scene.add(room.scene)
// scale to the size the props, camera and lights were tuned for: walls at about ±3.92, floor at y -0.37
room.scene.scale.setScalar(1.4)
room.scene.position.y = -0.65
room.scene.updateMatrixWorld(true) // surfaceUnder() raycasts it before the first render
// Trim to one workstation (main + angled monitor, one PC, one chair) and clear the tables for our props.
for (const name of [
  'Cube004_3', 'Cube031_47', 'Cube032_48', 'Cube033_49', 'Cube034_50', 'Cube017_38', 'Plane009_23', 'Sphere002_26', 'Sphere003_27', 'Cylinder012_72', // left monitor, keyboard, mouse, speakers, mug
  'Cube038_52', 'Cube022_54', // the bookshelf's own books (our manga fill it, decor.js)
  'Cylinder021_33', 'Cylinder020_80', 'Cylinder010_70', 'Cylinder013_73', // cup + glass in front of the TV, mug + bottle on the desk
  'Circle_16', 'Plane016_91', 'Cylinder033_42', // wall clock above the TV (the neon goes there), picture frame + wall lamp (a window goes there)
  'Cube007_8', 'Cube009_12', 'Cube025_39', 'Cylinder032_40', // the room's PCs (ours is PROPS.pc)
  'Cube035_58', 'Cube036_59', 'Cylinder038_60', 'Cylinder039_61', 'Cylinder040_62', 'Cylinder041_63', 'Cylinder042_64', 'Cylinder043_65', 'Cylinder044_66', 'Cylinder045_67', // left chair
  'Cube023_31', 'Cube001_35', 'Cylinder029_36', // remote on the side table
  'Cylinder037_83', 'Cylinder034_81', 'Cylinder035_82', 'Cylinder036_46', // bottle, glasses, book on the coffee table
]) room.scene.getObjectByName(name)?.removeFromParent()
// Frames on the back wall, bigger and centred between the left wall (x -3.92) and the door frame (x 1.64):
// family photo (left), my paper (middle), family photo (right). x = world centre, scale = size multiplier; heights unchanged.
for (const [name, x, scale] of [['Plane010_86', -2.36, 1.2], ['Plane015_90', -1.03, 1.35], ['Plane014_89', 0.19, 1.35]]) {
  const frame = room.scene.getObjectByName(name)
  frame.scale.multiplyScalar(scale)
  frame.updateMatrixWorld(true)
  const c = new THREE.Box3().setFromObject(frame).getCenter(new THREE.Vector3())
  frame.position.copy(frame.parent.worldToLocal(c.clone().setX(x).add(frame.getWorldPosition(new THREE.Vector3())).sub(c)))
  frame.updateMatrixWorld(true)
}
// ...then the desk: just tabletop + legs, shorter, centred on the wall left of the door, workstation in the middle.
const DESK = { center: -1.92, length: 4 } // left end flush with the left wall (x -3.92)
const v = new THREE.Vector3()
// move a mesh's vertices in world space; fn(worldVertex) edits it in place
const editVerts = (mesh, fn) => {
  // the compressed model stores positions as int16 within the mesh's own bounds; moving a vertex past them
  // wraps around to the other side, so switch to plain floats first
  const q = mesh.geometry.attributes.position
  const pos = new THREE.BufferAttribute(new Float32Array(q.count * 3), 3)
  for (let i = 0; i < q.count; i++) pos.setXYZ(i, q.getX(i), q.getY(i), q.getZ(i))
  mesh.geometry.setAttribute('position', pos)
  const toLocal = mesh.matrixWorld.clone().invert()
  for (let i = 0; i < pos.count; i++) {
    fn(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld))
    v.applyMatrix4(toLocal)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  mesh.geometry.computeBoundingBox()
  mesh.geometry.computeBoundingSphere()
}
const deskNode = room.scene.getObjectByName('Plane008_56')
const deskMeshes = []
deskNode.traverse((m) => m.isMesh && deskMeshes.push(m))
deskMeshes.filter((m) => m.material.name === 'Drawers').forEach((m) => m.removeFromParent())
const tabletop = deskMeshes.find((m) => m.material.name === 'WoodenShelves')
let deskBox = new THREE.Box3().setFromObject(tabletop)
// the wooden panels that framed the drawers are welded into the tabletop mesh: drop every triangle below the top
const g = tabletop.geometry
const idx = Array.from(g.index.array)
const keep = []
for (let t = 0; t < idx.length; t += 3) {
  const y = (k) => v.fromBufferAttribute(g.attributes.position, idx[t + k]).applyMatrix4(tabletop.matrixWorld).y
  if ((y(0) + y(1) + y(2)) / 3 > deskBox.max.y - 0.1) keep.push(idx[t], idx[t + 1], idx[t + 2])
}
g.setIndex(keep)
// squash the top to DESK.length around DESK.center; legs keep their size and move with their end
const oldCenter = (deskBox.min.x + deskBox.max.x) / 2
const k = DESK.length / (deskBox.max.x - deskBox.min.x)
editVerts(tabletop, (p) => (p.x = DESK.center + (p.x - oldCenter) * k))
const endShift = { left: DESK.center - DESK.length / 2 - deskBox.min.x, right: DESK.center + DESK.length / 2 - deskBox.max.x }
editVerts(room.scene.getObjectByName('Cylinder001_57').children.find((m) => m.isMesh), (p) => (p.x += p.x < oldCenter ? endShift.left : endShift.right))
deskBox = new THREE.Box3().setFromObject(tabletop)
const workstation = ['Cube006_6', 'Cube005_5', 'Cube014_92', 'Cube026_93', 'Cube027_94', 'Cube028_95', 'Cube015_21', 'Plane007_22', 'Sphere001_25', 'Sphere_24', 'Cylinder022_105']
  .map((n) => room.scene.getObjectByName(n))
const wsBox = new THREE.Box3()
workstation.forEach((o) => wsBox.expandByObject(o))
const wsDx = DESK.center - (wsBox.min.x + wsBox.max.x) / 2
for (const o of workstation) {
  o.getWorldPosition(v)
  v.x += wsDx
  o.position.copy(o.parent.worldToLocal(v))
  o.updateMatrixWorld(true)
}

const propObjects = {}
Object.entries(PROPS).forEach(([key, cfg], i) => {
  const model = props[i].scene
  model.traverse((o) => o.isLight && o.removeFromParent())
  const wrapper = new THREE.Group()
  wrapper.add(model)
  placeProp(wrapper, model, cfg)
  scene.add(wrapper)
  propObjects[key] = { wrapper, model, cfg }
})

const decor = dressRoom({ scene, room: room.scene, ...Object.fromEntries(Object.entries(propObjects).map(([k, p]) => [k, p.wrapper])) })

// ---------- hotspots ----------
const named = { ...decor.objects, ...Object.fromEntries(Object.entries(propObjects).map(([k, p]) => [k, p.wrapper])) }
const meshToHotspot = new Map()
for (const h of HOTSPOTS) {
  h.objects = (h.nodes ?? []).map((n) => named[n] ?? room.scene.getObjectByName(n)).filter(Boolean)
  h.meshes = []
  for (const obj of h.objects) {
    obj.traverse((m) => {
      if (!m.isMesh) return
      // materials are shared across objects; clone so highlight is per-hotspot (some meshes have a material array)
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone()
      h.meshes.push(m)
      meshToHotspot.set(m, h)
    })
  }
}

const accent = new THREE.Color(0xff8906) // palette orange
function highlight(h, on) {
  for (const m of h?.meshes ?? []) {
    m.userData.hover = on // decor.js leaves hovered materials alone
    for (const mat of [].concat(m.material)) {
      if (!mat.emissive) continue
      mat.emissive.copy(on ? accent : new THREE.Color(0)).multiplyScalar(on ? 0.35 : 1)
      if (on) mat.emissiveIntensity = 1
    }
  }
}

function focus(h, panelOpen = true, done) {
  const box = new THREE.Box3()
  h.objects.forEach((o) => box.expandByObject(o))
  const center = box.getCenter(new THREE.Vector3())
  flyTo(center.clone().add(new THREE.Vector3(...h.view)), center, panelOpen, done)
  return box
}

// Shift the rendered image left while a panel is open so the focused object isn't hidden behind it.
const viewShift = { x: 0 }
function applyViewShift() {
  if (viewShift.x) camera.setViewOffset(innerWidth, innerHeight, viewShift.x, 0, innerWidth, innerHeight)
  else camera.clearViewOffset()
}
addEventListener('resize', applyViewShift)

// on: zoomed into the monitor. leaving: flying back out. Both skip OrbitControls, whose angle limits
// would otherwise yank the camera off the head-on screen view.
const monitor = { on: false, leaving: false, screen: null } // screen: the one we're zoomed into

gsap.ticker.lagSmoothing(0) // finish tweens on time even if frames are slow
function flyTo(pos, target, panelOpen = false, done) {
  const tween = { duration: 1.2, ease: 'power3.inOut', overwrite: true }
  gsap.to(camera.position, { ...pos, ...tween, onComplete: () => { monitor.leaving = false; done?.() } })
  gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, ...tween })
  const shift = panelOpen && innerWidth > 640 ? 230 : 0 // half the panel width (see dialog CSS)
  gsap.to(viewShift, { x: shift, ...tween, onUpdate: applyViewShift })
}

// ---------- panels ----------
function openPanel(id, h = HOTSPOTS.find((x) => x.panel === id)) {
  if (document.body.classList.contains('plain')) {
    const tile = document.getElementById(`tile-${id}`) // plain view: scroll to that tile in #plain (Credits has none, so it opens)
    if (tile) return tile.scrollIntoView({ behavior: 'smooth', block: 'center' })
    document.getElementById(id).show()
    return
  }
  document.querySelectorAll('dialog[open]').forEach((d) => d.id !== id && d.close('switch'))
  const away = [leaveMonitor(), hideBubble(), unzoom()].some(Boolean) // call them all
  if (away && !h) flyTo(homePosition(), HOME_TARGET, true)
  if (h) focus(h)
  document.getElementById(id).show()
}

function closePanels() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close())
  if ([leaveMonitor(), hideBubble(), unzoom()].some(Boolean)) flyTo(homePosition(), HOME_TARGET)
}

// ---------- comic speech bubbles: for the non-CV stuff, pinned above the object instead of a side panel ----------
const bubble = { el: null, box: new THREE.Box3() }

function showBubble(h) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close('switch'))
  leaveMonitor()
  hideBubble()
  const box = focus(h, false, () => {
    bubble.el = document.getElementById(h.bubble)
    bubble.box.copy(box)
    typeOut(bubble.el)
    placeBubble()
    bubble.el.hidden = false
  })
  if (!h.still) hop(h.objects[0])
}

// ---------- zoom-only hotspots: fly to the object, nothing opens ----------
let zoomed = false
function zoomTo(h) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close('switch'))
  leaveMonitor()
  hideBubble()
  zoomed = true
  focus(h, false)
}
// Returns whether we were zoomed in.
function unzoom() {
  const was = zoomed
  zoomed = false
  return was
}

// Returns whether one was showing.
function hideBubble() {
  if (!bubble.el) return false
  bubble.el.hidden = true
  bubble.el = null
  return true
}

// Speech bubbles point at the top of the object; square panels sit off its right edge (as seen on screen), centred.
function placeBubble() {
  const { min, max } = bubble.box
  let x, y
  if (bubble.el.classList.contains('panel')) {
    const corners = [...Array(8).keys()].map((i) => new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera))
    const ys = corners.map((p) => p.y)
    x = Math.max(...corners.map((p) => p.x))
    y = (Math.max(...ys) + Math.min(...ys)) / 2
  } else {
    const p = new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2).project(camera)
    ;({ x, y } = p)
  }
  bubble.el.style.left = `${((x + 1) / 2) * innerWidth}px`
  bubble.el.style.top = `${((1 - y) / 2) * innerHeight}px`
}

// Wrap each letter in a span with its index once; CSS staggers them in (re-runs every time it's unhidden).
function typeOut(el) {
  if (el.dataset.typed) return
  el.dataset.typed = 1
  let i = 0
  const walker = document.createTreeWalker(el.querySelector('.say'), NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  for (const node of nodes) {
    const frag = document.createDocumentFragment()
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part || /\s/.test(part)) { frag.append(part); continue }
      const word = document.createElement('span') // keeps words from breaking between letters
      word.className = 'word'
      for (const ch of part) {
        const span = document.createElement('span')
        span.textContent = ch
        span.style.setProperty('--i', i++)
        word.append(span)
      }
      frag.append(word)
    }
    node.replaceWith(frag)
  }
}

// Little excited hop (back to the same height even if clicked mid-hop).
function hop(obj) {
  obj.userData.baseY ??= obj.position.y
  gsap.fromTo(obj.position, { y: obj.userData.baseY }, { y: obj.userData.baseY + 0.15, duration: 0.14, ease: 'power1.out', yoyo: true, repeat: 3, overwrite: true })
}

// ---------- monitors: zoom in, then lay a real HTML page (.desktop) over the screen ----------
// decor.screens: { key: { center, w, h, right, up, normal } } in world space; the page is .desktop[data-screen=key].
const screens = Object.entries(decor.screens).map(([key, rect]) => {
  const el = document.querySelector(`.desktop[data-screen="${key}"]`)
  el.style.height = `${(1280 * rect.h) / rect.w}px` // width is 1280px in style.css
  return { key, rect, el }
})
const desktop = screens.find((s) => s.key === 'projects').el

// Fit a page over its screen's on-screen rectangle. Only shown once the camera is head-on, so a
// flat 2D overlay is exact (a CSS 3D transform would track the fly-in, but browsers won't hit-test it).
function placeDesktop({ rect, el }) {
  camera.lookAt(rect.center) // the render loop hasn't aimed the camera for this frame yet
  camera.updateMatrixWorld()
  const px = (du, dv) => {
    const p = rect.center.clone().addScaledVector(rect.right, du * rect.w).addScaledVector(rect.up, dv * rect.h).project(camera)
    return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight]
  }
  const [x0, y0] = px(-0.5, 0.5)
  const [x1] = px(0.5, 0.5)
  el.style.transform = `translate(${x0}px, ${y0}px) scale(${(x1 - x0) / 1280})`
}
// Head-on, close enough that the screen fills most of the viewport.
function monitorPose(rect) {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.92
  const dist = Math.max(rect.h / (2 * tan), rect.w / (2 * tan * camera.aspect))
  return rect.center.clone().addScaledVector(rect.normal, dist)
}

function enterMonitor(key, app) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close('switch'))
  if (app) openApp(app)
  const s = screens.find((x) => x.key === key)
  if (monitor.screen === s) return
  monitor.screen?.el.classList.remove('on')
  Object.assign(monitor, { on: true, leaving: false, screen: s })
  controls.enabled = false
  highlight(hovered, false) // the page covers the canvas now, so pointermove won't clear it
  hovered = null
  tooltip.hidden = true
  flyTo(monitorPose(s.rect), s.rect.center, false, () => {
    if (monitor.screen !== s) return
    placeDesktop(s)
    s.el.classList.add('on')
  })
}

// Returns whether we were zoomed in, so the caller can fly somewhere else.
function leaveMonitor() {
  if (!monitor.on) return false
  monitor.screen.el.classList.remove('on')
  Object.assign(monitor, { on: false, leaving: true, screen: null })
  controls.enabled = true
  return true
}

function openApp(id) {
  desktop.querySelectorAll('.window').forEach((w) => (w.hidden = w.dataset.win !== id))
}
desktop.querySelectorAll('[data-app]').forEach((b) => b.addEventListener('click', () => openApp(b.dataset.app)))
desktop.querySelectorAll('.win-close').forEach((b) => b.addEventListener('click', () => openApp('terminal')))
document.querySelectorAll('.desktop-exit').forEach((b) => b.addEventListener('click', closePanels))
const clocks = document.querySelectorAll('.clock')
const tick = () => clocks.forEach((c) => (c.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })))
tick()
setInterval(tick, 10_000)
addEventListener('resize', () => {
  if (!monitor.on) return
  camera.position.copy(monitorPose(monitor.screen.rect))
  placeDesktop(monitor.screen)
})

document.querySelectorAll('dialog').forEach((d) => {
  d.autofocus = true // focus the panel itself on open, not its close button
  d.querySelector('.close')?.addEventListener('click', () => d.close())
  // returnValue 'switch' = another panel is opening, so don't fly home in between
  d.addEventListener('close', () => {
    if (d.returnValue !== 'switch' && !document.querySelector('dialog[open]')) flyTo(homePosition(), HOME_TARGET)
    d.returnValue = ''
  })
})
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
  closeMenu()
  const plain = document.body.classList.contains('plain')
  if (b.dataset.screen && !plain) enterMonitor(b.dataset.screen)
  else openPanel(b.dataset.open)
}))

// ---------- menu (top right): expands into the section list ----------
const menuBtn = document.getElementById('menu-toggle')
const nav = document.getElementById('nav')
function closeMenu() {
  nav.classList.remove('open')
  menuBtn.setAttribute('aria-expanded', 'false')
}
menuBtn.addEventListener('click', () => {
  const open = nav.classList.toggle('open')
  menuBtn.setAttribute('aria-expanded', open)
})
addEventListener('pointerdown', (e) => !e.target.closest('.menu') && closeMenu()) // click anywhere else closes it
addEventListener('keydown', (e) => e.key === 'Escape' && (closeMenu(), closePanels()))
// shareable links: /#research opens that section
if (location.hash && document.querySelector(`dialog${location.hash}`)) openPanel(location.hash.slice(1))

// ---------- lofi: autoplays (as soon as the browser allows), controls on the MP3 player's screen ----------
// The footer toggle is the always-visible way to stop it.
const musicHotspot = HOTSPOTS.find((x) => x.action === 'music')
const soundBtn = document.getElementById('sound')
soundBtn.addEventListener('click', () => decor.music.toggle())
decor.music.onChange(({ playing }) => {
  musicHotspot.label = playing ? 'Lofi player' : 'Play lofi'
  soundBtn.textContent = playing ? '♪ Music on' : '♪ Music off'
  soundBtn.setAttribute('aria-pressed', playing)
})
decor.music.autostart()

const MUSIC_ACTIONS = {
  toggle: () => decor.music.toggle(),
  next: () => decor.music.next(),
  prev: () => decor.music.prev(),
  up: () => decor.music.volume(0.04),
  down: () => decor.music.volume(-0.04),
  spotify: () => open(document.getElementById('spotify-link').href, '_blank', 'noopener'), // URL lives in index.html
}

// ---------- dark mode (the lamp, or the moon/sun button in the header: works in plain view too) ----------
const themeBtn = document.getElementById('theme-toggle')
themeBtn.addEventListener('click', toggleDark)
function toggleDark() {
  const dark = document.body.classList.toggle('dark')
  themeBtn.setAttribute('aria-pressed', dark)
  themeBtn.setAttribute('aria-label', dark ? 'Light mode' : 'Dark mode')
  const t = { duration: 0.8 }
  gsap.to(hemi, { intensity: dark ? 0.15 : 1.2, ...t })
  gsap.to(sun, { intensity: dark ? 0.05 : 1.8, ...t })
  gsap.to(lampLights, { intensity: dark ? 1.6 : 0, ...t })
  gsap.to(scene, { environmentIntensity: dark ? 0.08 : 0.6, ...t })
  gsap.to(decor.state, { night: dark ? 1 : 0, ...t })
  hideLightsHint()
}

// First visit only: a little label pointing at the lamp, until they toggle the lights or click anything.
const lightsHint = document.getElementById('lights-hint')
const lampCenter = new THREE.Box3().setFromObject(room.scene.getObjectByName('Cylinder031_41')).getCenter(new THREE.Vector3())
let hintSeen = true
try { hintSeen = !!localStorage.getItem('lightsHintSeen') } catch {}
function hideLightsHint() {
  if (lightsHint.hidden) return
  lightsHint.hidden = true
  try { localStorage.setItem('lightsHintSeen', '1') } catch {}
}
function placeLightsHint() {
  const p = lampCenter.clone().project(camera)
  lightsHint.style.left = `${((p.x + 1) / 2) * innerWidth}px`
  lightsHint.style.top = `${((1 - p.y) / 2) * innerHeight}px`
}
if (!hintSeen && !document.body.classList.contains('plain')) lightsHint.hidden = false
if (location.search.includes('night')) toggleDark() // ?night starts with the lights off

// ---------- pointer ----------
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const tooltip = document.getElementById('tooltip')
let hovered = null
let downAt = null

function pick(e) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects(scene.children, true)[0]
  const h = hit && meshToHotspot.get(hit.object)
  // apps on the monitor screen get their own label/panel; buttons on the MP3 screen control the music
  const app = hit?.object === decor.screenMesh ? decor.screenAppAt(hit.uv) : null
  const ctrl = hit?.object === decor.mp3Mesh ? decor.mp3ControlAt(hit.uv) : null
  return { h, app, ctrl }
}

// hover raycasts at most once per frame (mousemove can fire several times per frame)
let hoverQueued = false
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || hoverQueued) return
  hoverQueued = true
  requestAnimationFrame(() => {
    hoverQueued = false
    hover(e)
  })
})
function hover(e) {
  const { h, app, ctrl } = pick(e)
  if (h !== hovered) {
    highlight(hovered, false)
    highlight(h, true)
    hovered = h
  }
  canvas.style.cursor = h ? 'pointer' : ''
  tooltip.hidden = !h
  if (h) {
    tooltip.textContent = ctrl?.label ?? app?.label ?? h.label
    tooltip.style.left = `${e.clientX}px`
    tooltip.style.top = `${e.clientY}px`
  }
}
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]))
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return // was a drag
  hideLightsHint()
  const { h, app, ctrl } = pick(e)
  if (h?.action === 'toggleDark') toggleDark()
  else if (ctrl) MUSIC_ACTIONS[ctrl.id]()
  else if (app) enterMonitor('projects', app.id)
  else if (h?.action === 'monitor') enterMonitor(h.screen)
  else if (h?.bubble) showBubble(h)
  else if (h?.action === 'zoom' || h?.action === 'music') zoomTo(h) // music: clicking the player (not its buttons) just zooms in
  else if (h) openPanel(h.panel, h)
  else closePanels()
})

// ---------- debug placement (?debug) ----------
if (location.search.includes('debug')) {
  const { default: GUI } = await import('lil-gui')
  const gui = new GUI({ title: 'Prop placement' })
  for (const [key, { wrapper, model, cfg }] of Object.entries(propObjects)) {
    const f = gui.addFolder(key)
    const update = () => placeProp(wrapper, model, cfg)
    ;['x', 'y', 'z'].forEach((a, i) => f.add(cfg.position, i, -5, 5, 0.01).name(`pos ${a}`).onChange(update))
    f.add(cfg, 'rotationY', -Math.PI, Math.PI, 0.01).onChange(update)
    f.add(cfg, 'size', 0.1, 4, 0.01).onChange(update)
    ;['x', 'y', 'z'].forEach((a, i) => f.add(cfg.modelRotation, i, -Math.PI, Math.PI, Math.PI / 2).name(`model rot ${a}`).onChange(update))
  }
  gui.add({ copy: () => {
    const out = JSON.stringify(Object.fromEntries(Object.entries(PROPS).map(([k, { url, ...rest }]) => [k, rest])), null, 2)
    console.log(out)
    navigator.clipboard?.writeText(out)
  } }, 'copy').name('Copy values (paste into PROPS)')
}

const timer = new THREE.Timer()
let shadowsAt = -1
renderer.setAnimationLoop(() => {
  timer.update()
  const dt = Math.min(timer.getDelta(), 0.1)
  decor.update(timer.getElapsed(), dt)
  if (bubble.el) placeBubble()
  if (!lightsHint.hidden) placeLightsHint()
  bloom.enabled = decor.state.night > 0.01 // by day the threshold is so high that bloom adds next to nothing
  bloom.threshold = 3.2 - decor.state.night * 1.9 // 1.3 at night
  bloom.strength = 0.3 + decor.state.night * 0.35
  for (const l of lampLights) l.visible = l.intensity > 0 // lights at 0 still cost every pixel
  if (timer.getElapsed() - shadowsAt > 0.05) { // shadows ~20x a second is plenty
    renderer.shadowMap.needsUpdate = true
    shadowsAt = timer.getElapsed()
  }
  if (monitor.on || monitor.leaving) camera.lookAt(controls.target)
  else controls.update()
  composer.render()
})
