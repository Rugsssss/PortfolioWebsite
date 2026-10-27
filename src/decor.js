import * as THREE from 'three'

// Everything that dresses up the room: wall paint, LEDs, PC glow, live monitor, window sky,
// posters, plants, rug, mug, dust and idle motion. main.js handles interaction.
//
// Room coordinates (y up): floor y=-0.37, desk top y=1.37, left wall x≈-4.2 (door, desk),
// back wall z≈-4.2 (shelf, window at x -1.7..1.7, bed). Camera looks in from +x/+z.

const PALETTE = { wall: 0xcfc6e6, accent: 0x6c4ee0, bias: 0x4fd1ff, terracotta: 0xc0704f, leaf: [0x4f8a4b, 0x5fa058, 0x3f7a3c] }

// Drop real images at these paths to replace the drawn placeholders.
const POSTERS = {
  posterVoxel: { image: '/decor/voxel-engine.jpg', draw: drawVoxelPoster, w: 1.7, h: 1.2, position: [-4.21, 4.55, -1.2], rotationY: Math.PI / 2 },
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

export function dressRoom({ scene, room, pc }) {
  const state = { night: 0 } // 0 = day, 1 = night; tweened by main.js. RGB lights only come on at night (lamp click)
  const objects = {} // named clickable decor for HOTSPOTS
  const animated = [] // (t, dt) => void

  // ---------- paint + shadows ----------
  room.traverse((m) => {
    if (!m.isMesh) return
    const name = m.material.name
    if (name === 'pared') {
      m.material.map = null // drop the grey concrete, keep its bump
      m.material.color.set(PALETTE.wall)
      m.material.needsUpdate = true
    }
    // the outer shell + walls would block the sun from outside; everything else casts
    m.castShadow = name !== 'pared' && name !== 'afuera'
    m.receiveShadow = true
  })
  pc.traverse((m) => {
    if (!m.isMesh) return
    m.castShadow = !m.material.transparent // glass would shade the parts behind it
    if (m.material.name === 'mat24') Object.assign(m.material, { opacity: 0.12, roughness: 0.15 }) // case glass: clearer so the parts show
    m.receiveShadow = true
  })

  // ---------- LED strip (bias light behind the desk) ----------
  const biasMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: PALETTE.bias })
  const deskLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 4.3), biasMat)
  deskLed.position.set(-4.18, 1.4, -1.45)
  // wall wash: a spotlight pointing up the wall, so the glossy desk below stays out of the cone (a point light made a hotspot there)
  const deskLight = new THREE.SpotLight(PALETTE.bias, 0, 5, Math.PI / 3, 1, 1.5)
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
  animated.push((t, dt) => {
    rgb.setHSL((t * 0.25) % 1, 1, 0.55)
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
  const skyGeo = new THREE.PlaneGeometry(4.4, 4.6)
  const dayMat = new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, (c) => drawSky(c, false)), toneMapped: false })
  const nightMat = new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, (c) => drawSky(c, true)), toneMapped: false, transparent: true, opacity: 0 })
  const daySky = new THREE.Mesh(skyGeo, dayMat)
  const nightSky = new THREE.Mesh(skyGeo, nightMat)
  loadImageInto(daySky, '/decor/sydney-day.jpg')
  loadImageInto(nightSky, '/decor/sydney-night.jpg')
  nightSky.position.z = 0.01
  const windowView = new THREE.Group()
  windowView.add(daySky, nightSky)
  windowView.position.set(0, 4.1, -4.9)
  scene.add(windowView)
  objects.window = windowView
  animated.push(() => (nightSky.material.opacity = state.night))

  // ---------- posters ----------
  for (const [key, p] of Object.entries(POSTERS)) {
    const tex = canvasTexture(p.w > p.h ? 768 : 512, p.w > p.h ? 540 : 690, p.draw)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
    const poster = new THREE.Group()
    const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.1, p.h + 0.1, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a2433 }))
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

  // ---------- plants ----------
  scene.add(makePlant(1, [-1.45, -0.37, -3.7]), makePlant(0.35, [-2.05, 4.13, -3.75]))

  // ---------- mug + steam ----------
  const mug = new THREE.Group()
  const mugMat = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5 })
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.22, 16), mugMat)
  cup.position.y = 0.11
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 8, 16), mugMat)
  handle.position.set(0, 0.12, 0.1)
  handle.rotation.y = Math.PI / 2
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), new THREE.MeshStandardMaterial({ color: 0x3b2314 }))
  coffee.rotation.x = -Math.PI / 2
  coffee.position.y = 0.2
  mug.add(cup, handle, coffee)
  mug.traverse((m) => m.isMesh && (m.castShadow = true))
  mug.position.set(-3.75, 1.37, 0.55)
  scene.add(mug)

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
      s.position.set(-3.75 + Math.sin(t * 2 + i) * 0.03, 1.6 + k * 0.5, 0.55)
      s.scale.setScalar(0.1 + k * 0.15)
      s.material.opacity = Math.sin(k * Math.PI) * 0.5
    })
  })

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
    update: (t, dt) => animated.forEach((fn) => fn(t, dt)),
  }
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

function makePlant(scale, position) {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 8), new THREE.MeshStandardMaterial({ color: PALETTE.terracotta, flatShading: true }))
  pot.position.y = 0.25
  g.add(pot)
  const rand = seeded(position[0] * 100 + 3)
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22 + rand() * 0.14, 0),
      new THREE.MeshStandardMaterial({ color: PALETTE.leaf[i % 3], flatShading: true }),
    )
    const a = (i / 9) * Math.PI * 2
    const r = i === 0 ? 0 : 0.18 + rand() * 0.12
    leaf.position.set(Math.cos(a) * r, 0.7 + rand() * 0.55, Math.sin(a) * r)
    leaf.rotation.set(rand() * 3, rand() * 3, 0)
    g.add(leaf)
  }
  g.traverse((m) => m.isMesh && (m.castShadow = true))
  g.scale.setScalar(scale)
  g.position.set(...position)
  return g
}

// ---------- canvas drawings ----------
function drawDesktop(c, t) {
  c.setTransform(1, 0, 0, 1024 / 576, 0, 0) // draw in 1024×576, stretched to the square texture
  const bg = c.createLinearGradient(0, 0, 1024, 576)
  bg.addColorStop(0, '#2b1f5c')
  bg.addColorStop(1, '#6c4ee0')
  c.fillStyle = bg
  c.fillRect(0, 0, 1024, 576)

  // apps
  c.textAlign = 'center'
  for (const a of APPS) {
    c.fillStyle = 'rgba(255,255,255,0.14)'
    roundRect(c, a.x + 14, a.y, 68, 68, 14)
    c.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
    c.fillStyle = '#fff'
    c.fillText(a.icon, a.x + 48, a.y + 49)
    c.font = '600 17px system-ui, sans-serif'
    c.fillText(a.label, a.x + 48, a.y + 94)
  }

  // terminal
  const tx = 300, ty = 50, tw = 680, th = 420
  c.fillStyle = 'rgba(14,12,24,0.92)'
  roundRect(c, tx, ty, tw, th, 12)
  c.fillStyle = '#2a2540'
  roundRect(c, tx, ty, tw, 34, 12)
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
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
    c.fillStyle = line.startsWith('$') ? '#a995ff' : '#e6e1f5'
    c.fillText(shown, tx + 24, y)
    if (chars <= 0 && Math.floor(t * 2) % 2) c.fillRect(tx + 26 + c.measureText(shown).width, y - 18, 11, 22)
    y += 40
  }

  // taskbar
  c.fillStyle = 'rgba(10,8,20,0.75)'
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

function drawVoxelPoster(c, w, h) {
  c.fillStyle = '#1b1530'
  c.fillRect(0, 0, w, h)
  const s = 22 // cube size
  const ox = w / 2
  const oy = 240
  const height = (i, j) => Math.max(1, Math.round(3 + 2 * Math.sin(i * 0.7) + 1.6 * Math.cos(j * 0.55) + Math.sin((i + j) * 0.3)))
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      const hgt = height(i, j)
      for (let k = 0; k < hgt; k++) {
        const x = ox + (i - j) * s
        const y = oy + (i + j) * s * 0.5 - k * s
        const water = hgt <= 2 && k === hgt - 1
        const top = water ? '#4fb4ff' : k === hgt - 1 ? (hgt > 5 ? '#f1f1f1' : '#6cc04a') : '#8a5a3c'
        face(c, top, [[x, y], [x + s, y + s / 2], [x, y + s], [x - s, y + s / 2]])
        face(c, shade(water ? '#3a8fd0' : '#8a5a3c', 0.8), [[x - s, y + s / 2], [x, y + s], [x, y + 2 * s], [x - s, y + 1.5 * s]])
        face(c, shade(water ? '#3a8fd0' : '#8a5a3c', 0.6), [[x + s, y + s / 2], [x, y + s], [x, y + 2 * s], [x + s, y + 1.5 * s]])
      }
    }
  }
  c.fillStyle = '#fff'
  c.font = '800 54px system-ui, sans-serif'
  c.textAlign = 'center'
  c.fillText('VOXEL ENGINE', w / 2, 70)
  c.font = '22px system-ui, sans-serif'
  c.fillStyle = '#a995ff'
  c.fillText('ModernGL · shaders · procedural terrain', w / 2, 104)
}

// Fan "wanted poster": twin suns over the desert, the bounty, love & peace.
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
  c.fillStyle = '#fbfaf6'
  c.fillRect(0, 0, w, h)
  c.fillStyle = '#6c4ee0'
  c.fillRect(0, 0, w, 64)
  c.fillStyle = '#fff'
  c.font = '700 22px system-ui, sans-serif'
  c.fillText('BIDA 2025 · Springer Nature', 28, 40)
  c.fillStyle = '#1d1b26'
  c.font = '800 34px Georgia, serif'
  ;['Enhancing Stress', 'and Anxiety Detection', 'with Multimodal', 'Sensor Data'].forEach((l, i) => c.fillText(l, 28, 128 + i * 42))
  c.font = 'italic 20px Georgia, serif'
  c.fillStyle = '#5d5870'
  c.fillText('R. Deshmukh — first author', 28, 316)
  // three wearable signals
  ;[['ACC', '#6c4ee0', 9], ['TEMP', '#e07a4e', 3], ['EDA', '#2a9d8f', 5]].forEach(([name, col, f], k) => {
    const y0 = 380 + k * 100
    c.fillStyle = '#5d5870'
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

function drawRug(c) {
  const rings = ['#3b2f6b', '#e9e4f2', '#6c4ee0', '#f2c38b', '#3b2f6b', '#a995ff', '#e9e4f2']
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
