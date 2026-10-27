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
  pc: { url: '/models/gaming-pc.glb', size: 1.75, modelRotation: [0, 0, 0], position: [-3.2, 1.37, -3.18], rotationY: Math.PI },
  controller: { url: '/models/controller.glb', size: 0.55, modelRotation: [0, 0, Math.PI / 2], position: [-2.85, 1.37, 0.35], rotationY: 0 },
  spike: { url: '/models/spike.glb', size: 0.8, modelRotation: [0, 0, 0], position: [-2.12, 4.13, -3.75], rotationY: 0.4 }, // on the shelf, next to the books
  mp3: { url: '/models/mp3-player.glb', size: 0.85, modelRotation: [0, 0, 0], position: [2.6, 0.92, 1.4], rotationY: -0.5, snap: true }, // on the bed (y snaps to the sheet)
  neon: { url: '/models/neon.glb', size: 2.2, modelRotation: [0, 0, 0], position: [-4.06, 3.5, -1.2], rotationY: 0 }, // left wall, above the monitor
  pet: { url: '/models/pet.glb', size: 1.5, modelRotation: [0, 0, 0], position: [3.3, 0.9, -1.3], rotationY: 0.94, snap: true }, // golden lab napping on the bed, face toward the room
  mug: { url: '/models/mug.glb', size: 0.62, modelRotation: [0, 0, 0], position: [-3.75, 1.37, 0.45], rotationY: 0 }, // desk, USyd logo added in decor.js
}

// Clickable things -> which <dialog> to open. nodes = room node names (from the .gltf),
// PROPS keys, 'door', or decor objects (posterPaper, posterTrigun, window, gsoc).
// view = where the camera sits relative to the object's center when zoomed in.
// The first hotspot for a panel is where the nav buttons fly to.
const HOTSPOTS = [
  { label: 'Projects', panel: 'projects', nodes: ['Pantalla_20', 'Teclado_23', 'Raton_21', 'Alfombrilla_16'], view: [4.5, 1.2, 0.8] },
  { label: 'Systems', panel: 'systems', nodes: ['pc'], view: [3.6, 1.8, 3.8] },
  { label: 'Graphics & Games', panel: 'graphics', nodes: ['controller'], view: [1.4, 1.4, 1.2] },
  { label: 'Research', panel: 'research', nodes: ['Libros_28', 'Estanteria_27'], view: [0.8, 0.4, 3.6] },
  { label: 'My paper', panel: 'research', nodes: ['posterPaper'], view: [0, 0, 3.6] },
  { label: 'About me', panel: 'about', nodes: ['Cama_4', 'Cojin_5', 'sabana_6', 'Mesa_noche_25'], view: [5, 4, 6] },
  { label: 'Sydney', panel: 'about', nodes: ['window'], view: [0, -0.6, 5.2] },
  { label: 'Fun facts', panel: 'fun', nodes: ['posterTrigun'], view: [3.4, 0, 0] },
  { label: 'Valorant', panel: 'fun', nodes: ['spike'], view: [1.6, 1.0, 2.0] },
  { label: 'Play lofi', panel: 'fun', action: 'music', nodes: ['mp3'], view: [0.25, 2.2, 0.35] }, // near top-down
  { label: 'Neon', panel: 'fun', nodes: ['neon'], view: [5, 0.5, 0] },
  { label: 'Pet', panel: 'fun', nodes: ['pet'], view: [2.2, 1.6, 2.2] },
  { label: 'GSoC', panel: 'projects', nodes: ['gsoc'], view: [0, 0, 3] },
  { label: 'USyd', panel: 'about', nodes: ['mug'], view: [1.6, 0.9, 1.4] },
  { label: 'Contact', panel: 'contact', nodes: ['Pomo_24', 'door'], view: [6, 0.8, 0.5] },
  { label: '???', panel: 'secret', nodes: ['Papelera_3', 'Papeles_2', 'Papel_1'], view: [2.2, 1.6, 1.6] },
  { label: 'Lights', action: 'toggleDark', nodes: ['Lampara_26'] },
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap

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
const lampLight = new THREE.PointLight(0xffb36b, 0, 4, 2) // short reach so it doesn't wash over the window
lampLight.position.set(0.25, 1.35, -3.3) // inside the shade
scene.add(hemi, sun, lampLight)

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
room.scene.updateMatrixWorld(true) // surfaceUnder() raycasts it before the first render
room.scene.getObjectByName('Ordenador_19')?.removeFromParent() // replaced by the gaming PC

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

// The door is baked into the wall mesh, so give it an invisible hit box around the knob.
const doorBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.2, 4.2, 1.8),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
)
doorBox.position.set(-4.5, 1.7, 3.6)
scene.add(doorBox)

const decor = dressRoom({ scene, room: room.scene, ...Object.fromEntries(Object.entries(propObjects).map(([k, p]) => [k, p.wrapper])) })

// ---------- hotspots ----------
const named = { door: doorBox, ...decor.objects, ...Object.fromEntries(Object.entries(propObjects).map(([k, p]) => [k, p.wrapper])) }
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

function focus(h) {
  const box = new THREE.Box3()
  h.objects.forEach((o) => box.expandByObject(o))
  const center = box.getCenter(new THREE.Vector3())
  flyTo(center.clone().add(new THREE.Vector3(...h.view)), center, true)
}

// Shift the rendered image left while a panel is open so the focused object isn't hidden behind it.
const viewShift = { x: 0 }
function applyViewShift() {
  if (viewShift.x) camera.setViewOffset(innerWidth, innerHeight, viewShift.x, 0, innerWidth, innerHeight)
  else camera.clearViewOffset()
}
addEventListener('resize', applyViewShift)

gsap.ticker.lagSmoothing(0) // finish tweens on time even if frames are slow
function flyTo(pos, target, panelOpen = false) {
  const tween = { duration: 1.2, ease: 'power3.inOut', overwrite: true }
  gsap.to(camera.position, { ...pos, ...tween })
  gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, ...tween })
  const shift = panelOpen && innerWidth > 640 ? 230 : 0 // half the panel width (see dialog CSS)
  gsap.to(viewShift, { x: shift, ...tween, onUpdate: applyViewShift })
}

// ---------- panels ----------
function openPanel(id, h = HOTSPOTS.find((x) => x.panel === id)) {
  if (document.body.classList.contains('plain')) {
    document.getElementById(id).scrollIntoView({ behavior: 'smooth' })
    return
  }
  document.querySelectorAll('dialog[open]').forEach((d) => d.id !== id && d.close('switch'))
  if (h) focus(h)
  document.getElementById(id).show()
}

function closePanels() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close())
}

document.querySelectorAll('dialog').forEach((d) => {
  d.autofocus = true // focus the panel itself on open, not its close button
  d.querySelector('.close')?.addEventListener('click', () => d.close())
  // returnValue 'switch' = another panel is opening, so don't fly home in between
  d.addEventListener('close', () => {
    if (d.returnValue !== 'switch' && !document.querySelector('dialog[open]')) flyTo(homePosition(), HOME_TARGET)
    d.returnValue = ''
  })
})
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.open)))
addEventListener('keydown', (e) => e.key === 'Escape' && closePanels())
if (location.search.includes('night')) toggleDark() // ?night starts with the lights off
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

// ---------- dark mode (the lamp) ----------
function toggleDark() {
  const dark = document.body.classList.toggle('dark')
  const t = { duration: 0.8 }
  gsap.to(hemi, { intensity: dark ? 0.15 : 1.2, ...t })
  gsap.to(sun, { intensity: dark ? 0.05 : 1.8, ...t })
  gsap.to(lampLight, { intensity: dark ? 3.5 : 0, ...t })
  gsap.to(scene, { environmentIntensity: dark ? 0.08 : 0.6, ...t })
  gsap.to(decor.state, { night: dark ? 1 : 0, ...t })
}

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

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return
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
})
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]))
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return // was a drag
  const { h, app, ctrl } = pick(e)
  if (h?.action === 'toggleDark') toggleDark()
  else if (ctrl) MUSIC_ACTIONS[ctrl.id]()
  else if (app) openPanel(app.panel, h)
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
renderer.setAnimationLoop(() => {
  timer.update()
  const dt = Math.min(timer.getDelta(), 0.1)
  decor.update(timer.getElapsed(), dt)
  bloom.threshold = 3.2 - decor.state.night * 1.9 // high by day so floor reflections don't glow; 1.3 at night
  bloom.strength = 0.3 + decor.state.night * 0.35
  controls.update()
  composer.render()
})
