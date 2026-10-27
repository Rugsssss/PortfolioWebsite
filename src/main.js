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
}

// Clickable things -> which <dialog> to open. nodes = room node names (from the .gltf),
// PROPS keys, 'door', or decor objects (posterVoxel, posterPaper, posterTrigun, window).
// view = where the camera sits relative to the object's center when zoomed in.
// The first hotspot for a panel is where the nav buttons fly to.
const HOTSPOTS = [
  { label: 'Projects', panel: 'projects', nodes: ['Pantalla_20', 'Teclado_23', 'Raton_21', 'Alfombrilla_16'], view: [4.5, 1.2, 0.8] },
  { label: 'Systems', panel: 'systems', nodes: ['pc'], view: [3.6, 1.8, 3.8] },
  { label: 'Graphics & Games', panel: 'graphics', nodes: ['controller'], view: [1.4, 1.4, 1.2] },
  { label: 'Voxel Engine', panel: 'graphics', nodes: ['posterVoxel'], view: [3.8, 0, 0] },
  { label: 'Research', panel: 'research', nodes: ['Libros_28', 'Estanteria_27'], view: [0.8, 0.4, 3.6] },
  { label: 'My paper', panel: 'research', nodes: ['posterPaper'], view: [0, 0, 3.6] },
  { label: 'About me', panel: 'about', nodes: ['Cama_4', 'Cojin_5', 'sabana_6', 'Mesa_noche_25'], view: [5, 4, 6] },
  { label: 'Sydney', panel: 'about', nodes: ['window'], view: [0, -0.6, 5.2] },
  { label: 'Fun facts', panel: 'fun', nodes: ['posterTrigun'], view: [3.4, 0, 0] },
  { label: 'Contact', panel: 'contact', nodes: ['Pomo_24', 'door'], view: [6, 0.8, -0.5] },
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const DAY_BG = new THREE.Color(0xe4ddf2)
const NIGHT_BG = new THREE.Color(0x0e0c16)
const scene = new THREE.Scene()
scene.background = DAY_BG.clone() // bloom drops canvas alpha, so the background is drawn in-scene
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture
scene.environmentIntensity = 0.6

const hemi = new THREE.HemisphereLight(0xffffff, 0x8877aa, 1.2)
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
controls.minAzimuthAngle = -0.15 // room is open toward +x/+z, don't let people orbit behind the walls
controls.maxAzimuthAngle = Math.PI / 2 + 0.15

function homePosition() {
  // back off further on portrait screens so the whole room fits
  const dist = 22 * Math.max(1, 1.1 / camera.aspect)
  return HOME_TARGET.clone().addScaledVector(HOME_DIR, dist)
}

// Bloom only catches really bright things (LEDs, screen, fans); the threshold drops at night.
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.5, 2.2)
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
  document.getElementById('progress').textContent = `${Math.round((loaded / total) * 100)}%`
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
}

const [room, ...props] = await Promise.all([
  loader.loadAsync('/models/room.glb'),
  ...Object.values(PROPS).map((p) => loader.loadAsync(p.url)),
])
scene.add(room.scene)
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

const decor = dressRoom({ scene, room: room.scene, pc: propObjects.pc.wrapper })

// ---------- hotspots ----------
const named = { door: doorBox, ...decor.objects, ...Object.fromEntries(Object.entries(propObjects).map(([k, p]) => [k, p.wrapper])) }
const meshToHotspot = new Map()
for (const h of HOTSPOTS) {
  h.objects = (h.nodes ?? []).map((n) => named[n] ?? room.scene.getObjectByName(n)).filter(Boolean)
  h.meshes = []
  for (const obj of h.objects) {
    obj.traverse((m) => {
      if (!m.isMesh) return
      m.material = m.material.clone() // materials are shared across objects; clone so highlight is per-hotspot
      h.meshes.push(m)
      meshToHotspot.set(m, h)
    })
  }
}

const accent = new THREE.Color(0x6c4ee0)
function highlight(h, on) {
  for (const m of h?.meshes ?? []) {
    if (!m.material.emissive) continue
    m.userData.hover = on // decor.js leaves hovered materials alone
    m.material.emissive.copy(on ? accent : new THREE.Color(0)).multiplyScalar(on ? 0.35 : 1)
    if (on) m.material.emissiveIntensity = 1
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

// ---------- dark mode (the lamp) ----------
function toggleDark() {
  const dark = document.body.classList.toggle('dark')
  const t = { duration: 0.8 }
  gsap.to(hemi, { intensity: dark ? 0.15 : 1.2, ...t })
  gsap.to(sun, { intensity: dark ? 0.05 : 1.8, ...t })
  gsap.to(lampLight, { intensity: dark ? 3.5 : 0, ...t })
  gsap.to(scene, { environmentIntensity: dark ? 0.08 : 0.6, ...t })
  const bg = dark ? NIGHT_BG : DAY_BG
  gsap.to(scene.background, { r: bg.r, g: bg.g, b: bg.b, ...t })
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
  // apps on the monitor screen get their own label/panel
  const app = hit?.object === decor.screenMesh ? decor.screenAppAt(hit.uv) : null
  return { h, app }
}

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return
  const { h, app } = pick(e)
  if (h !== hovered) {
    highlight(hovered, false)
    highlight(h, true)
    hovered = h
  }
  canvas.style.cursor = h ? 'pointer' : ''
  tooltip.hidden = !h
  if (h) {
    tooltip.textContent = app?.label ?? h.label
    tooltip.style.left = `${e.clientX}px`
    tooltip.style.top = `${e.clientY}px`
  }
})
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]))
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return // was a drag
  const { h, app } = pick(e)
  if (h?.action === 'toggleDark') toggleDark()
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

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  decor.update(clock.elapsedTime, dt)
  bloom.threshold = 2.2 - decor.state.night * 0.9
  bloom.strength = 0.3 + decor.state.night * 0.35
  controls.update()
  composer.render()
})
