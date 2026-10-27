import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'

// Everything that dresses up the room: wall paint, LEDs, PC glow, live monitor, window sky,
// posters, plants, rug, mug, dust and idle motion. main.js handles interaction.
//
// Room coordinates (y up): floor y=-0.37, desk top y=1.37, left wall x≈-4.2 (door, desk),
// back wall z≈-4.2 (shelf, window at x -1.7..1.7, bed). Camera looks in from +x/+z.

// Happy Hues palette 13 (same as the CSS tokens in style.css)
const PALETTE = { ink: '#0f0e17', paper: '#fffffe', slate: '#2e2f3e', grey: '#a7a9be', orange: '#ff8906', red: '#f25f4c', pink: '#e53170', wood: '#5c2c18' }

// Drop real images at these paths to replace the drawn placeholders.
const POSTERS = {
  posterPaper: { image: '/decor/paper.jpg', draw: drawPaperPoster, w: 1.15, h: 1.55, position: [3.1, 3.55, -4.18], rotationY: 0 },
  posterTrigun: { image: '/decor/trigun.jpg', draw: drawTrigunPoster, w: 1.04, h: 1.6, position: [-4.12, 3.68, 3.2], rotationY: Math.PI / 2 }, // on the door, above the knob
}

// Desktop "apps" on the monitor, in screen pixels (1024×576). panel = which <dialog> opens.
const APPS = [
  { label: 'Voxel Engine', icon: '🧊', panel: 'graphics' },
  { label: 'PictoPy', icon: '🖼️', panel: 'projects' },
  { label: 'RPRMS', icon: '📈', panel: 'systems' },
  { label: 'Kiwix', icon: '📚', panel: 'projects' },
].map((a, i) => ({ ...a, x: 36, y: 36 + i * 118, w: 96, h: 104 }))

const TERMINAL = [
  '$ whoami',
  'rugved — software engineer, Sydney',
  '$ ls ~/projects',
  'voxel-engine  pictopy  rprms  kiwix',
  '$ cat now.txt',
  'MPE (Software) @ University of Sydney',
  '$ ./open --hint',
  '← click an app to explore',
]

export function dressRoom({ scene, room, pc, spike, mp3, neon, mug }) {
  const state = { night: 0 } // 0 = day, 1 = night; tweened by main.js. RGB lights only come on at night (lamp click)
  const objects = {} // named clickable decor for HOTSPOTS
  const animated = [] // (t, dt) => void

  // ---------- animated Persona-style background (full-screen shader behind everything) ----------
  const bgUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uAspect: { value: 1 } }
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: bgUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); } // ignores the camera: always fills the screen
      `,
      fragmentShader: BG_SHADER,
    }),
  )
  bg.frustumCulled = false
  bg.renderOrder = -1 // drawn first
  bg.raycast = () => {}
  scene.add(bg)
  animated.push((t) => {
    bgUniforms.uTime.value = t
    bgUniforms.uNight.value = state.night
    bgUniforms.uAspect.value = innerWidth / innerHeight
  })

  // ---------- paint + shadows ----------
  const woodMat = new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.65 })
  let rims // 'afuera' = the white wall rims AND the window frame; only the frame goes wood
  room.traverse((m) => {
    if (!m.isMesh) return
    const name = m.material.name
    if (name === 'suelo') Object.assign(m.material, { roughness: 1, metalness: 0 }) // matte floor: its glossy highlight glowed
    if (name === 'puerta') m.material = woodMat
    if (name === 'afuera') rims = m
    if (name === 'pared') {
      m.material.map = null // drop the grey concrete, keep its bump
      m.material.color.set(PALETTE.paper)
      m.material.needsUpdate = true
    }
    // the outer shell + walls would block the sun from outside; everything else casts
    m.castShadow = name !== 'pared' && name !== 'afuera'
    m.receiveShadow = true
  })
  room.updateMatrixWorld(true)
  splitMaterial(rims, (c) => c.z < -4.0 && Math.abs(c.x) < 1.95 && c.y > 1.2 && c.y < 5.8, woodMat) // window frame

  pc.traverse((m) => {
    if (!m.isMesh) return
    m.castShadow = !m.material.transparent // glass would shade the parts behind it
    if (m.material.name === 'mat24') Object.assign(m.material, { opacity: 0.12, roughness: 0.15 }) // case glass: clearer so the parts show
    m.receiveShadow = true
  })

  // ---------- LED strip (bias light behind the desk) ----------
  const biasMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: PALETTE.pink })
  const deskLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 4.3), biasMat)
  deskLed.position.set(-4.18, 1.4, -1.45)
  // wall wash: a spotlight pointing up the wall, so the glossy desk below stays out of the cone (a point light made a hotspot there)
  const deskLight = new THREE.SpotLight(PALETTE.pink, 0, 5, Math.PI / 3, 1, 1.5)
  deskLight.position.set(-3.95, 1.45, -0.4)
  deskLight.target.position.set(-4.2, 3.4, -0.4)
  scene.add(deskLed, deskLight, deskLight.target)

  // ---------- PC: RGB fans that spin and glow ----------
  const fanRings = []
  pc.traverse((m) => m.isMesh && m.material.name === 'mat8' && fanRings.push(m)) // mat8 = the red fan rings (and the case trim)
  const fanBlades = []
  for (const ring of fanRings) {
    const blades = ring.parent.children.find((c) => c.isMesh && c.material.name === 'mat23')
    ring.geometry.computeBoundingBox()
    // mat8 is also used on case trim (long strips, tiny bits); a fan ring is a ~0.44 square
    const s = ring.geometry.boundingBox.getSize(new THREE.Vector3())
    const isFan = s.y > 0.3 && s.y < 0.6 && Math.abs(s.y - s.z) < 0.05
    if (!isFan || !blades) continue
    // spin each fan on its own pivot; the blade geometry is shared between fans, so don't modify it
    blades.geometry.computeBoundingBox()
    const pivot = new THREE.Group()
    blades.geometry.boundingBox.getCenter(pivot.position)
    blades.parent.add(pivot)
    pivot.add(blades)
    blades.position.sub(pivot.position)
    fanBlades.push(pivot)
  }
  const pcBox = new THREE.Box3().setFromObject(pc)
  const pcLight = new THREE.PointLight(0xff3366, 0, 3.5, 1.5)
  pcLight.position.copy(pcBox.getCenter(new THREE.Vector3())) // inside the case, lights the parts behind the glass
  scene.add(pcLight)
  const rgb = new THREE.Color()
  const fanColors = [PALETTE.orange, PALETTE.red, PALETTE.pink].map((c) => new THREE.Color(c))
  animated.push((t, dt) => {
    const k = (t * 0.75) % 3 // one full orange -> red -> pink loop every 4s
    rgb.lerpColors(fanColors[Math.floor(k)], fanColors[(Math.floor(k) + 1) % 3], k % 1)
    for (const m of fanRings) {
      if (m.userData.hover) continue
      m.material.emissive.copy(rgb)
      m.material.emissiveIntensity = 1.2 * state.night
    }
    for (const b of fanBlades) b.rotation.x += dt * 9
    pcLight.color.copy(rgb)
    pcLight.intensity = 1.8 * state.night
  })

  // ---------- monitor: live desktop ----------
  let screenMesh
  room.getObjectByName('Pantalla_20').traverse((m) => m.isMesh && m.material.name === 'screen' && (screenMesh = m))
  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = screenCanvas.height = 1024 // the screen UVs use a square texture stretched to 16:9
  const screenTex = new THREE.CanvasTexture(screenCanvas)
  screenTex.colorSpace = THREE.SRGBColorSpace
  screenMesh.material = new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 })
  screenMesh.material.name = 'screen'
  let lastDraw = -1
  animated.push((t) => {
    if (t - lastDraw < 0.08) return
    lastDraw = t
    drawDesktop(screenCanvas.getContext('2d'), t)
    screenTex.needsUpdate = true
  })
  // uv -> app under the pointer
  const screenAppAt = (uv) => {
    const x = uv.x * 1024
    const y = (1 - uv.y) * 576
    return APPS.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h)
  }

  // ---------- window: Sydney photos (drawn skyline until they load), day + night ----------
  // Photos: see the credits dialog in index.html. Both planes sit behind the wall, visible only through the window.
  const skyGeo = new THREE.PlaneGeometry(5, 5) // oversized so no angle sees past its edges (the opening is ~3.4 wide)
  const dayMat = new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, (c) => drawSky(c, false)), toneMapped: false })
  const nightMat = new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, (c) => drawSky(c, true)), toneMapped: false, transparent: true, opacity: 0 })
  const daySky = new THREE.Mesh(skyGeo, dayMat)
  const nightSky = new THREE.Mesh(skyGeo, nightMat)
  loadImageInto(daySky, '/decor/sydney-day.jpg')
  loadImageInto(nightSky, '/decor/sydney-night.jpg')
  nightSky.position.z = 0.01
  const windowView = new THREE.Group()
  windowView.add(daySky, nightSky)
  windowView.position.set(0, 3.6, -4.6) // inside the wall's thickness (-4.2..-4.68) so it only shows through the opening; y 1.1-6.1
  scene.add(windowView)
  objects.window = windowView
  animated.push(() => (nightSky.material.opacity = state.night))

  // ---------- posters ----------
  for (const [key, p] of Object.entries(POSTERS)) {
    const tex = canvasTexture(p.w > p.h ? 768 : 512, p.w > p.h ? 540 : 690, p.draw)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
    const poster = new THREE.Group()
    const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.1, p.h + 0.1, 0.04), new THREE.MeshStandardMaterial({ color: PALETTE.ink }))
    const art = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat)
    loadImageInto(art, p.image)
    art.position.z = 0.021
    frame.castShadow = true
    poster.add(frame, art)
    poster.position.set(...p.position)
    poster.rotation.y = p.rotationY
    scene.add(poster)
    objects[key] = poster
  }

  // ---------- subtle pink underglow on the floor around the bed (as if from an LED strip under it) ----------
  const bedBox = new THREE.Box3().setFromObject(room.getObjectByName('Cama_4'))
  let floor
  room.traverse((m) => m.isMesh && m.material.name === 'suelo' && (floor = m))
  const floorBox = new THREE.Box3().setFromObject(floor)
  // glow rectangle = bed footprint + pad, clipped to the floor so it never hangs past the room's open edges
  const pad = 1.2
  const x0 = Math.max(bedBox.min.x - pad, floorBox.min.x), x1 = Math.min(bedBox.max.x + pad, floorBox.max.x)
  const z0 = Math.max(bedBox.min.z - pad, floorBox.min.z), z1 = Math.min(bedBox.max.z + pad, floorBox.max.z)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, z1 - z0),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 512, (c, w, h) => {
        // bed-shaped rectangle with a wide soft shadowBlur halo (works in every browser, unlike ctx.filter).
        // Canvas x runs x0 -> x1, canvas y runs z0 -> z1 (the plane is laid flat facing up).
        const u = (x) => ((x - x0) / (x1 - x0)) * w
        const v = (z) => ((z - z0) / (z1 - z0)) * h
        c.shadowColor = PALETTE.pink
        c.shadowBlur = 60
        c.fillStyle = PALETTE.pink
        c.fillRect(u(bedBox.min.x), v(bedBox.min.z), u(bedBox.max.x) - u(bedBox.min.x), v(bedBox.max.z) - v(bedBox.min.z))
        // soft-erase the glow under/around the nightstand, it looked like a stray pink patch at its base
        const ns = new THREE.Box3().setFromObject(room.getObjectByName('Mesa_noche_25')).expandByScalar(0.15)
        c.globalCompositeOperation = 'destination-out'
        c.shadowColor = '#000'
        c.shadowBlur = 30
        c.fillStyle = '#000'
        c.fillRect(u(ns.min.x), v(ns.min.z), u(ns.max.x) - u(ns.min.x), v(ns.max.z) - v(ns.min.z))
      }),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  glow.rotation.x = -Math.PI / 2
  glow.position.set((x0 + x1) / 2, -0.345, (z0 + z1) / 2) // just above floor + rug
  glow.raycast = () => {}
  scene.add(glow)
  animated.push(() => (glow.material.opacity = 0.25 + state.night * 0.55))

  // ---------- rug ----------
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 48),
    new THREE.MeshStandardMaterial({ map: canvasTexture(512, 512, drawRug), roughness: 1 }),
  )
  rug.rotation.x = -Math.PI / 2
  rug.scale.set(1.25, 1, 1)
  rug.position.set(-0.5, -0.355, 1.1)
  rug.receiveShadow = true
  scene.add(rug)

  // ---------- University of Sydney logo printed on the mug (props.mug) ----------
  // A decal projects the logo onto the curved side that faces the room. It's parented to the mug
  // so ?debug placement carries it along.
  mug.updateMatrixWorld(true)
  let cupMesh
  mug.traverse((m) => m.isMesh && m.material.name !== 'Coffee' && !cupMesh && (cupMesh = m))
  const mugBox = new THREE.Box3().setFromObject(cupMesh)
  const mugCenter = mugBox.getCenter(new THREE.Vector3())
  const mugSize = mugBox.getSize(new THREE.Vector3())
  const toCamera = new THREE.Vector3(1, 0, 1).normalize() // home camera looks in from +x/+z
  const projector = new THREE.Object3D()
  projector.position.copy(mugCenter).addScaledVector(toCamera, Math.max(mugSize.x, mugSize.z) / 2)
  projector.lookAt(mugCenter)
  projector.rotateY(Math.PI) // face outward, otherwise the logo comes out mirrored
  const logoSize = mugSize.y * 0.62
  const decalGeo = new DecalGeometry(cupMesh, projector.position, projector.rotation, new THREE.Vector3(logoSize, logoSize, mugSize.x))
  decalGeo.applyMatrix4(new THREE.Matrix4().copy(mug.matrixWorld).invert()) // world -> mug-local
  const logo = new THREE.Mesh(decalGeo, new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.5 }))
  loadImageInto(logo, '/decor/usyd-logo.png')
  mug.add(logo)
  const mugTop = mugBox.max.y

  const puff = canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,0.8)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 64)
  })
  const steam = [0, 1, 2].map(() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false }))
    s.raycast = () => {} // don't block clicks
    scene.add(s)
    return s
  })
  animated.push((t) => {
    steam.forEach((s, i) => {
      const k = (t * 0.35 + i / 3) % 1
      s.position.set(mug.position.x + Math.sin(t * 2 + i) * 0.03, mugTop + 0.05 + k * 0.5, mug.position.z)
      s.scale.setScalar(0.1 + k * 0.15)
      s.material.opacity = Math.sin(k * Math.PI) * 0.5
    })
  })

  // ---------- Valorant Spike (props.spike): gunmetal body, glowing cyan core like in-game ----------
  // The model ships flat white/orange/green materials, so recolour by material name.
  // the visible light strips are the orange ('material') and green ('Mat.5') parts; the *_Emissive ones sit inside
  const SPIKE_METAL = { Bomb_S0_MI: '#3b3f45', 'Mat.1': '#2c2f34', 'Mat.3': '#4a4e55', 'Mat.6': '#55595f' }
  const SPIKE_GLOW = { material: '#59d9ff', 'Mat.5': '#e6fbff', Bomb_S0_Temp_Emissive: '#59d9ff', Bomb_S0_Temp_Core_Emissive: '#e6fbff' }
  const spikeLights = []
  spike.traverse((m) => {
    if (!m.isMesh) return
    const name = m.material.name
    if (SPIKE_METAL[name]) Object.assign(m.material, { metalness: 0.55, roughness: 0.45 }).color.set(SPIKE_METAL[name])
    if (SPIKE_GLOW[name]) {
      m.material.color.set(SPIKE_GLOW[name])
      spikeLights.push({ mesh: m, color: new THREE.Color(SPIKE_GLOW[name]) })
    }
  })
  animated.push((t) => {
    const glow = (1.3 + Math.sin(t * 2) * 0.3) * (1 + state.night * 0.8) // gentle steady pulse, brighter at night
    // read .material each frame: clickable meshes get cloned materials in main.js, and hover resets emissive
    for (const { mesh, color } of spikeLights) {
      if (mesh.userData.hover) continue
      mesh.material.emissive.copy(color)
      mesh.material.emissiveIntensity = glow
    }
  })

  // ---------- music notes drifting up from the MP3 player (props.mp3) ----------
  const noteTex = canvasTexture(64, 64, (c) => {
    c.fillStyle = PALETTE.orange
    c.font = 'bold 52px system-ui, sans-serif'
    c.textAlign = 'center'
    c.fillText('♪', 32, 50)
  })
  const notes = [0, 1, 2].map(() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, depthWrite: false }))
    s.raycast = () => {}
    scene.add(s)
    return s
  })
  animated.push((t) => {
    const p = mp3.position // read live so ?debug placement moves the notes too
    notes.forEach((s, i) => {
      const k = (t * 0.25 + i / 3) % 1
      s.position.set(p.x + Math.sin(t + i * 2) * 0.15, p.y + 0.2 + k * 0.8, p.z + Math.cos(t * 0.8 + i) * 0.1)
      s.scale.setScalar(0.12 + k * 0.06)
      s.material.opacity = Math.sin(k * Math.PI) * 0.9
    })
  })

  // ---------- GSoC sticker on the wall above the books (text only, no Google logo) ----------
  const gsoc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.76),
    new THREE.MeshStandardMaterial({ map: canvasTexture(512, 340, drawGsocSticker), transparent: true, roughness: 0.6 }),
  )
  gsoc.position.set(-3.1, 5.6, -4.18)
  gsoc.rotation.z = 0.06
  scene.add(gsoc)
  objects.gsoc = gsoc

  // ---------- neon sign: soft by day, bright with a little tube flicker at night ----------
  const neonMeshes = []
  neon.traverse((m) => m.isMesh && neonMeshes.push(m))
  animated.push((t) => {
    const flicker = 1 - state.night * 0.08 * (Math.sin(t * 37) * Math.sin(t * 13) > 0.6 ? 1 : 0)
    for (const m of neonMeshes) {
      if (m.userData.hover) continue
      m.material.emissive.setHex(0xffffff) // hover highlight resets emissive, so restore it
      m.material.emissiveIntensity = (1 + state.night * 1.1) * flicker
    }
  })

  // ---------- lofi player on the MP3 player's screen ----------
  const music = createMusic()
  setupMp3Screen(mp3, animated, music)
  let mp3Mesh
  mp3.traverse((m) => m.isMesh && !mp3Mesh && (mp3Mesh = m))

  // ---------- dust in the air ----------
  const dustGeo = new THREE.BufferGeometry()
  const rand = seeded(7)
  const dustBase = new Float32Array(Array.from({ length: 160 * 3 }, (_, i) => [rand() * 8 - 4, rand() * 6, rand() * 8 - 4][i % 3]))
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustBase.slice(), 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: puff, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false }))
  dust.raycast = () => {}
  scene.add(dust)
  animated.push((t) => {
    const pos = dustGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, dustBase[i * 3] + Math.sin(t * 0.2 + i) * 0.15, (dustBase[i * 3 + 1] + t * 0.05 * (1 + (i % 3))) % 6, dustBase[i * 3 + 2] + Math.cos(t * 0.15 + i) * 0.15)
    }
    pos.needsUpdate = true
    dust.material.opacity = 0.6 - state.night * 0.35
  })

  // ---------- chair sways a little ----------
  const chair = room.getObjectByName('Silla_22')
  const chairPivot = new THREE.Group()
  new THREE.Box3().setFromObject(chair).getCenter(chairPivot.position)
  scene.add(chairPivot)
  chairPivot.attach(chair)
  animated.push((t) => (chairPivot.rotation.y = Math.sin(t * 0.4) * 0.12))

  // ---------- lamp shade glows at night, LEDs brighten ----------
  const lampMeshes = []
  room.getObjectByName('Lampara_26').traverse((m) => m.isMesh && m.material.name === 'lamapra' && lampMeshes.push(m))
  animated.push(() => {
    biasMat.emissiveIntensity = 1.4 * state.night // keep near the bloom threshold so it glows without flaring
    deskLight.intensity = 12 * state.night
    // lamp meshes are cloned for hover highlight later, so read .material each frame
    for (const m of lampMeshes) {
      if (m.userData.hover) continue
      m.material.emissive.setHex(0xffa060)
      m.material.emissiveIntensity = state.night * 0.6
    }
  })

  return {
    state,
    objects,
    screenMesh,
    screenAppAt,
    music,
    mp3Mesh,
    mp3ControlAt,
    update: (t, dt) => animated.forEach((fn) => fn(t, dt)),
  }
}

// Diagonal gradient + rotating sunburst + drifting halftone dots + sliding slashes, Persona-menu style.
const BG_SHADER = /* glsl */ `
  uniform float uTime, uNight, uAspect;
  varying vec2 vUv;
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); } // palette hexes are sRGB; the scene renders in linear
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec3 ink = lin(vec3(0.059, 0.055, 0.090)), slate = lin(vec3(0.180, 0.184, 0.243)), paper = lin(vec3(1.0));
    vec3 orange = lin(vec3(1.0, 0.537, 0.024)), red = lin(vec3(0.949, 0.373, 0.298)), pink = lin(vec3(0.898, 0.192, 0.439));

    // day: pink -> red -> orange sweep; night: ink -> slate
    float g = smoothstep(-0.9, 0.9, p.x * 0.6 + p.y * 0.8 + 0.2 * sin(uTime * 0.25));
    vec3 day = g < 0.5 ? mix(pink, red, g * 2.0) : mix(red, orange, g * 2.0 - 1.0);
    vec3 col = mix(day, mix(ink, slate, g), uNight);

    // sunburst rays from the bottom-left, slowly turning
    vec2 c = p - vec2(-0.75 * uAspect, -0.65);
    float rays = step(0.5, fract(atan(c.y, c.x) * 18.0 / 6.2832 + uTime * 0.02));
    col *= 1.0 + rays * mix(0.12, 0.35, uNight);

    // halftone dots on a 45° grid, drifting; bigger toward the top-right. Ink by day, pink at night
    vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p * 42.0 + vec2(uTime * 0.6, 0.0);
    float r = 0.08 + 0.3 * smoothstep(-0.4, 1.0, p.x + p.y);
    float dots = 1.0 - smoothstep(r - 0.04, r + 0.04, length(fract(q) - 0.5));
    col = mix(col, mix(ink, pink, uNight), dots * mix(0.22, 0.18, uNight));

    // slanted slashes sliding across: paper by day, orange at night
    float s = fract((p.y + p.x * 0.45) * 1.3 - uTime * 0.03);
    float slash = smoothstep(0.012, 0.0, abs(s - 0.5) - 0.035);
    col = mix(col, mix(paper, orange, uNight), slash * mix(0.35, 0.18, uNight));

    gl_FragColor = vec4(col, 1.0);
  }
`

// ---------- lofi music + MP3 player screen ----------
// Tracks: Pixabay Content License, credited in index.html. Nothing downloads until someone presses play.
const TRACKS = [
  { title: 'Tokyo Lofi', artist: 'Zephira Music', src: '/music/tokyo-lofi.mp3' },
  { title: 'Lofi Gaming', artist: 'Zephira Music', src: '/music/lofi-gaming.mp3' },
]

// Tiny looping playlist, driven by the buttons on the MP3 player's screen and the footer toggle.
function createMusic() {
  const audio = new Audio()
  audio.preload = 'none'
  audio.volume = 0.12 // quiet by default
  let index = 0
  let touched = false // the visitor used a music control, so autostart must not override them
  const listeners = []
  const load = (i) => {
    index = (i + TRACKS.length) % TRACKS.length
    audio.src = TRACKS[index].src
    audio.play().catch(() => {})
  }
  const music = {
    audio,
    get track() { return TRACKS[index] },
    get playing() { return !audio.paused },
    toggle() {
      touched = true
      if (!audio.paused) return audio.pause()
      if (!audio.src) audio.src = TRACKS[index].src
      audio.play().catch(() => {})
    },
    next() { touched = true; load(index + 1) },
    prev() { touched = true; load(index - 1) },
    volume(delta) {
      touched = true
      audio.volume = Math.min(0.6, Math.max(0, +(audio.volume + delta).toFixed(2)))
    },
    // Browsers block sound until the visitor interacts: try now, else start on their first click/keypress.
    autostart() {
      const start = () => {
        if (touched || !audio.paused) return
        if (!audio.src) audio.src = TRACKS[index].src
        audio.play().catch(() => {})
      }
      audio.src = TRACKS[index].src
      audio.play().then(() => {}, () => {
        // 'click' (not pointerdown) so the canvas/footer handlers run first and can mark `touched`
        addEventListener('click', start, { once: true })
        addEventListener('keydown', start, { once: true })
      })
    },
    onChange: (fn) => listeners.push(fn),
  }
  audio.addEventListener('ended', () => load(index + 1))
  for (const e of ['play', 'pause', 'loadstart', 'volumechange']) audio.addEventListener(e, () => listeners.forEach((fn) => fn(music)))
  return music
}

// The screen is the 180x210 px white patch at (777, 407) in the model's 1024 texture, stored sideways and
// mirrored: holding the player upright (screen above the wheel), the device's right is the texture's down
// and its down is the texture's right. We redraw a copy of the texture with the player UI in that patch
// (plus a black copy as the emissive map so only the screen glows). Found by painting test colours.
const MP3_SCREEN = { x: 777, y: 407, w: 210, h: 180 } // x/y: patch corner in the texture; w/h: screen size held upright
const UI = { w: 290, h: 235 } // the player UI is laid out at this size, then scaled into MP3_SCREEN
const MP3_COLOR = PALETTE.pink // body tint (multiplied over the white texture; the screen is drawn after, untinted)
// Buttons on the screen, in UI coordinates. Shared by drawPlayer and mp3ControlAt.
const MP3_CONTROLS = [
  { id: 'prev', icon: '⏮', label: 'Previous track', x: 12, y: 172, w: 50, h: 48 },
  { id: 'toggle', icon: '⏯', label: 'Play / pause', x: 66, y: 172, w: 60, h: 48 },
  { id: 'next', icon: '⏭', label: 'Next track', x: 130, y: 172, w: 50, h: 48 },
  { id: 'down', icon: '−', label: 'Volume down', x: 184, y: 172, w: 45, h: 48 },
  { id: 'up', icon: '+', label: 'Volume up', x: 233, y: 172, w: 45, h: 48 },
  { id: 'spotify', label: 'My Spotify ↗', x: 236, y: 42, w: 42, h: 42 }, // drawn as the Spotify logo
]

// Raycast uv on the MP3 player -> the screen button under it (undoes the sideways/mirrored mapping above).
function mp3ControlAt(uv) {
  const sx = uv.y * 1024 - MP3_SCREEN.y // device right = texture down
  const sy = uv.x * 1024 - MP3_SCREEN.x // device down = texture right
  if (sx < 0 || sy < 0 || sx > MP3_SCREEN.w || sy > MP3_SCREEN.h) return null
  const x = (sx * UI.w) / MP3_SCREEN.w
  const y = (sy * UI.h) / MP3_SCREEN.h
  return MP3_CONTROLS.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null
}

function setupMp3Screen(mp3, animated, music) {
  let mesh
  mp3.traverse((m) => m.isMesh && !mesh && (mesh = m))
  const base = mesh.material.map.image
  const make = () => {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const tex = new THREE.CanvasTexture(c)
    tex.flipY = false // glTF UV convention
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }
  const colorTex = make()
  const glowTex = make()
  // matte plastic: drop the model's gloss textures (they'd multiply the roughness back down), flat roughness instead
  Object.assign(mesh.material, {
    map: colorTex, emissiveMap: glowTex, emissiveIntensity: 0.9,
    roughnessMap: null, metalnessMap: null, roughness: 1, metalness: 0, envMapIntensity: 0.25,
  })
  mesh.material.emissive.setHex(0xffffff)
  mesh.material.needsUpdate = true // adding an emissiveMap needs a shader recompile, else the whole device glows

  let last = -1
  animated.push((t) => {
    // read .material each frame: clickable meshes get cloned materials in main.js, and hover resets emissive
    if (!mesh.userData.hover) mesh.material.emissive.setHex(0xffffff)
    if (t - last < 0.5) return
    last = t
    const { currentTime, duration } = music.audio
    const progress = duration ? currentTime / duration : 0
    for (const [tex, withBase] of [[colorTex, true], [glowTex, false]]) {
      const c = tex.image.getContext('2d')
      c.setTransform(1, 0, 0, 1, 0, 0)
      if (withBase) {
        c.drawImage(base, 0, 0, 1024, 1024)
        c.globalCompositeOperation = 'multiply'
        c.fillStyle = MP3_COLOR
        c.fillRect(0, 0, 1024, 1024)
        c.globalCompositeOperation = 'source-over'
      }
      else c.clearRect(0, 0, 1024, 1024)
      c.setTransform(0, 1, 1, 0, MP3_SCREEN.x, MP3_SCREEN.y) // device (right, down) -> texture (down, right)
      c.scale(MP3_SCREEN.w / UI.w, MP3_SCREEN.h / UI.h)
      drawPlayer(c, UI.w, UI.h, music, progress)
      tex.needsUpdate = true
    }
  })
}

function drawPlayer(c, w, h, music, progress) {
  const { track, playing } = music
  c.save()
  c.beginPath()
  c.roundRect(0, 0, w, h, 14)
  c.clip()
  c.fillStyle = PALETTE.ink
  c.fillRect(0, 0, w, h)
  // status bar
  c.fillStyle = PALETTE.slate
  c.fillRect(0, 0, w, 30)
  c.fillStyle = playing ? PALETTE.orange : PALETTE.grey
  c.beginPath()
  c.arc(16, 15, 5, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = PALETTE.paper
  c.font = '600 15px system-ui, sans-serif'
  c.textAlign = 'left'
  c.fillText(playing ? 'Now Playing' : 'Paused', 28, 20)
  c.textAlign = 'right'
  c.fillStyle = PALETTE.grey
  c.fillText(`vol ${Math.round(music.audio.volume * 100)}%`, w - 12, 20)
  // cover (palette gradient + note)
  const ax = 14, ay = 40, as = 82
  const g = c.createLinearGradient(ax, ay, ax + as, ay + as)
  g.addColorStop(0, PALETTE.orange)
  g.addColorStop(1, PALETTE.pink)
  c.fillStyle = g
  c.fillRect(ax, ay, as, as)
  c.fillStyle = PALETTE.ink
  c.font = 'bold 44px system-ui, sans-serif'
  c.textAlign = 'center'
  c.fillText('♪', ax + as / 2, ay + as / 2 + 15)
  // title + artist, cut to fit
  c.textAlign = 'left'
  const fit = (text, font, max) => {
    c.font = font
    while (c.measureText(text).width > max && text.length > 1) text = text.slice(0, -2) + '…'
    return text
  }
  const tx = ax + as + 12, tw = w - tx - 58 // leave room for the Spotify button
  c.fillStyle = PALETTE.paper
  c.fillText(fit(track.title, 'bold 19px system-ui, sans-serif', tw), tx, ay + 30)
  c.fillStyle = PALETTE.grey
  c.fillText(fit(track.artist, '15px system-ui, sans-serif', tw), tx, ay + 54)
  // progress bar
  c.fillStyle = PALETTE.slate
  c.fillRect(14, 140, w - 28, 8)
  c.fillStyle = PALETTE.orange
  c.fillRect(14, 140, (w - 28) * progress, 8)
  // buttons
  c.textAlign = 'center'
  for (const b of MP3_CONTROLS) {
    if (b.id === 'spotify') {
      drawSpotifyLogo(c, b.x + b.w / 2, b.y + b.h / 2, b.w / 2)
      continue
    }
    c.fillStyle = b.id === 'toggle' ? PALETTE.orange : PALETTE.slate
    c.beginPath()
    c.roundRect(b.x, b.y, b.w, b.h, 10)
    c.fill()
    c.fillStyle = b.id === 'toggle' ? PALETTE.ink : PALETTE.paper
    c.font = 'bold 24px system-ui, sans-serif'
    c.fillText(b.id === 'toggle' ? (playing ? '❚❚' : '▶') : b.icon, b.x + b.w / 2, b.y + b.h / 2 + 8)
  }
  c.restore()
}

// Spotify mark: green disc with three curved bars.
function drawSpotifyLogo(c, cx, cy, r) {
  c.fillStyle = '#1ed760'
  c.beginPath()
  c.arc(cx, cy, r, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = '#000'
  c.lineCap = 'round'
  ;[[0.62, 0.16, -0.3], [0.5, 0.13, 0.02], [0.38, 0.1, 0.3]].forEach(([half, width, dy]) => {
    const y = cy + dy * r
    c.lineWidth = width * r
    c.beginPath()
    c.moveTo(cx - half * r, y)
    c.quadraticCurveTo(cx, y - 0.24 * r, cx + half * r, y + 0.06 * r)
    c.stroke()
  })
}

// ---------- helpers ----------
// Swap in a real image when it exists; if it's missing, the drawn placeholder stays.
// Takes the mesh, not the material: clickable meshes get their material cloned in main.js, so read it on load.
function loadImageInto(mesh, url) {
  new THREE.TextureLoader().load(url, (img) => {
    img.colorSpace = THREE.SRGBColorSpace
    mesh.material.map = img
    mesh.material.needsUpdate = true
  }, undefined, () => {})
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function seeded(s) {
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

function drawDesktop(c, t) {
  c.setTransform(1, 0, 0, 1024 / 576, 0, 0) // draw in 1024×576, stretched to the square texture
  const bg = c.createLinearGradient(0, 0, 1024, 576)
  bg.addColorStop(0, PALETTE.ink)
  bg.addColorStop(1, PALETTE.slate)
  c.fillStyle = bg
  c.fillRect(0, 0, 1024, 576)

  // apps
  c.textAlign = 'center'
  for (const a of APPS) {
    c.fillStyle = 'rgba(255,137,6,0.18)' // orange tint
    roundRect(c, a.x + 14, a.y, 68, 68, 14)
    c.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
    c.fillStyle = '#fff'
    c.fillText(a.icon, a.x + 48, a.y + 49)
    c.font = '600 17px system-ui, sans-serif'
    c.fillText(a.label, a.x + 48, a.y + 94)
  }

  // terminal
  const tx = 300, ty = 50, tw = 680, th = 420
  c.fillStyle = PALETTE.ink
  roundRect(c, tx, ty, tw, th, 12)
  c.fillStyle = PALETTE.slate
  roundRect(c, tx, ty, tw, 34, 12)
  ;[PALETTE.pink, PALETTE.orange, PALETTE.red].forEach((col, i) => {
    c.fillStyle = col
    c.beginPath()
    c.arc(tx + 22 + i * 22, ty + 17, 7, 0, Math.PI * 2)
    c.fill()
  })
  c.textAlign = 'left'
  c.font = '22px Consolas, "Courier New", monospace'
  // type the lines out, hold, then start over
  const total = TERMINAL.join('').length
  let chars = Math.min(total, Math.floor((t % 16) * 22))
  let y = ty + 76
  for (const line of TERMINAL) {
    if (chars <= 0) break
    const shown = line.slice(0, chars)
    chars -= line.length
    c.fillStyle = line.startsWith('$') ? PALETTE.orange : PALETTE.paper
    c.fillText(shown, tx + 24, y)
    if (chars <= 0 && Math.floor(t * 2) % 2) c.fillRect(tx + 26 + c.measureText(shown).width, y - 18, 11, 22)
    y += 40
  }

  // taskbar
  c.fillStyle = PALETTE.ink
  c.fillRect(0, 540, 1024, 36)
  c.fillStyle = '#fff'
  c.font = '600 18px system-ui, sans-serif'
  c.fillText('◆ rugved.dev', 16, 564)
  c.textAlign = 'right'
  c.fillText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 1008, 564)
}

function drawSky(c, night) {
  const g = c.createLinearGradient(0, 0, 0, 512)
  if (night) {
    g.addColorStop(0, '#070a24')
    g.addColorStop(1, '#2d2557')
  } else {
    g.addColorStop(0, '#7fb8ff')
    g.addColorStop(1, '#ffe0c4')
  }
  c.fillStyle = g
  c.fillRect(0, 0, 512, 512)
  const rand = seeded(42)
  if (night) {
    c.fillStyle = '#fff'
    for (let i = 0; i < 120; i++) c.fillRect(rand() * 512, rand() * 330, rand() * 2 + 0.5, rand() * 2 + 0.5)
    c.fillStyle = '#f5f0d8'
    c.beginPath()
    c.arc(390, 110, 26, 0, Math.PI * 2)
    c.fill()
  } else {
    c.fillStyle = 'rgba(255,250,230,0.9)'
    c.beginPath()
    c.arc(390, 120, 34, 0, Math.PI * 2)
    c.fill()
  }

  // skyline: towers, Harbour Bridge arch, Opera House sails
  const ink = night ? '#0b0a18' : '#5d6a8f'
  c.fillStyle = ink
  const base = 400
  for (let x = 0; x < 512; ) {
    const w = 18 + rand() * 26
    const h = 20 + rand() * 60
    c.fillRect(x, base - h, w, h + 120)
    if (night) {
      c.fillStyle = '#ffd77a'
      for (let wy = base - h + 8; wy < base - 6; wy += 12) for (let wx = x + 4; wx < x + w - 4; wx += 8) if (rand() > 0.6) c.fillRect(wx, wy, 3, 4)
      c.fillStyle = ink
    }
    x += w + 2
  }
  c.strokeStyle = ink
  c.lineWidth = 5
  c.beginPath()
  c.moveTo(0, 430)
  c.quadraticCurveTo(150, 330, 300, 430)
  c.stroke()
  c.fillRect(0, 428, 320, 6)
  c.fillStyle = night ? '#e8e2ff' : '#f7f4ee'
  ;[[330, 70], [372, 58], [410, 44]].forEach(([x, h]) => {
    c.beginPath()
    c.moveTo(x, 470)
    c.quadraticCurveTo(x + 6, 470 - h, x + 44, 470 - h)
    c.quadraticCurveTo(x + 30, 450, x + 48, 470)
    c.fill()
  })
  c.fillStyle = night ? '#141238' : '#4f86c6'
  c.fillRect(0, 470, 512, 42) // harbour
}

function drawTrigunPoster(c, w, h) {
  const paper = c.createRadialGradient(w / 2, h / 2, 80, w / 2, h / 2, h * 0.75)
  paper.addColorStop(0, '#f1dfb4')
  paper.addColorStop(1, '#b98f55')
  c.fillStyle = paper
  c.fillRect(0, 0, w, h)
  c.textAlign = 'center'
  c.fillStyle = '#3a2414'
  c.font = '900 92px Georgia, serif'
  c.fillText('WANTED', w / 2, 100)
  c.font = 'italic 700 24px Georgia, serif'
  c.fillText('— DEAD OR ALIVE —', w / 2, 136)

  // scene: sky, two suns, dunes
  const sx = 46, sy = 160, sw = w - 92, sh = 260
  const sky = c.createLinearGradient(0, sy, 0, sy + sh)
  sky.addColorStop(0, '#f7b267')
  sky.addColorStop(1, '#f4845f')
  c.fillStyle = sky
  c.fillRect(sx, sy, sw, sh)
  c.fillStyle = '#fff3c4'
  c.beginPath()
  c.arc(sx + sw * 0.38, sy + 90, 34, 0, Math.PI * 2)
  c.arc(sx + sw * 0.62, sy + 70, 24, 0, Math.PI * 2)
  c.fill()
  ;[['#c8553d', 190], ['#8c2f39', 225]].forEach(([col, y0]) => {
    c.fillStyle = col
    c.beginPath()
    c.moveTo(sx, sy + sh)
    for (let x = 0; x <= sw; x += 8) c.lineTo(sx + x, sy + y0 + Math.sin(x / 60 + y0) * 14)
    c.lineTo(sx + sw, sy + sh)
    c.fill()
  })
  c.strokeStyle = '#3a2414'
  c.lineWidth = 6
  c.strokeRect(sx, sy, sw, sh)

  c.fillStyle = '#b3261e'
  c.font = '900 64px Georgia, serif'
  c.fillText('TRIGUN', w / 2, 492)
  c.fillStyle = '#3a2414'
  c.font = '700 22px Georgia, serif'
  c.fillText('THE HUMANOID TYPHOON', w / 2, 524)
  c.font = '900 40px Georgia, serif'
  c.fillText('$$60,000,000,000', w / 2, 590)
  c.font = 'italic 700 30px Georgia, serif'
  c.fillStyle = '#b3261e'
  c.fillText('LOVE & PEACE!', w / 2, 650)
}

function drawPaperPoster(c, w, h) {
  c.fillStyle = PALETTE.paper
  c.fillRect(0, 0, w, h)
  c.fillStyle = PALETTE.pink
  c.fillRect(0, 0, w, 64)
  c.fillStyle = '#fff'
  c.font = '700 22px system-ui, sans-serif'
  c.fillText('BIDA 2025 · Springer Nature', 28, 40)
  c.fillStyle = PALETTE.ink
  c.font = '800 34px Georgia, serif'
  ;['Enhancing Stress', 'and Anxiety Detection', 'with Multimodal', 'Sensor Data'].forEach((l, i) => c.fillText(l, 28, 128 + i * 42))
  c.font = 'italic 20px Georgia, serif'
  c.fillStyle = PALETTE.slate
  c.fillText('R. Deshmukh — first author', 28, 316)
  // three wearable signals
  ;[['ACC', PALETTE.orange, 9], ['TEMP', PALETTE.red, 3], ['EDA', PALETTE.pink, 5]].forEach(([name, col, f], k) => {
    const y0 = 380 + k * 100
    c.fillStyle = PALETTE.slate
    c.font = '600 16px system-ui, sans-serif'
    c.fillText(name, 28, y0 - 28)
    c.strokeStyle = col
    c.lineWidth = 3
    c.beginPath()
    for (let x = 0; x <= w - 56; x += 4) {
      const v = Math.sin(x / (60 / f)) * 14 + Math.sin(x / 13 + k) * (k === 0 ? 10 : 3) + (k === 2 && x > 250 && x < 330 ? -26 * Math.sin(((x - 250) / 80) * Math.PI) : 0)
      x ? c.lineTo(28 + x, y0 + v) : c.moveTo(28 + x, y0 + v)
    }
    c.stroke()
  })
}

function drawGsocSticker(c, w, h) {
  c.fillStyle = PALETTE.orange
  c.strokeStyle = PALETTE.ink
  c.lineWidth = 10
  c.beginPath()
  c.roundRect(8, 8, w - 16, h - 16, 40)
  c.fill()
  c.stroke()
  c.textAlign = 'center'
  c.fillStyle = PALETTE.ink
  c.font = '800 96px Consolas, "Courier New", monospace'
  c.fillText('</>', w / 2, 130)
  c.font = '800 36px system-ui, sans-serif'
  c.fillText('Google Summer of Code', w / 2, 200)
  c.font = '600 26px system-ui, sans-serif'
  c.fillStyle = PALETTE.slate
  c.fillText('contributor · Kiwix · AOSSIE', w / 2, 250)
}

// Move the triangles whose world-space centre passes `test` onto a second material.
function splitMaterial(mesh, test, material) {
  const g = mesh.geometry
  const pos = g.attributes.position
  const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()]
  const v = new THREE.Vector3()
  const c = new THREE.Vector3()
  const keep = []
  const moved = []
  for (let i = 0; i < idx.length; i += 3) {
    c.set(0, 0, 0)
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx[i + k]))
    c.divideScalar(3).applyMatrix4(mesh.matrixWorld)
    ;(test(c) ? moved : keep).push(idx[i], idx[i + 1], idx[i + 2])
  }
  g.setIndex([...keep, ...moved])
  g.clearGroups()
  g.addGroup(0, keep.length, 0)
  g.addGroup(keep.length, moved.length, 1)
  mesh.material = [mesh.material, material]
}

function drawRug(c) {
  const rings = [PALETTE.ink, PALETTE.paper, PALETTE.orange, PALETTE.slate, PALETTE.pink, PALETTE.paper, PALETTE.red]
  rings.forEach((col, i) => {
    c.fillStyle = col
    c.beginPath()
    c.arc(256, 256, 256 - i * 34, 0, Math.PI * 2)
    c.fill()
  })
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fill()
}

function face(c, color, pts) {
  c.fillStyle = color
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.fill()
}

function shade(hex, f) {
  return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString()
}
