import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Everything that dresses up the room: matte surfaces, LEDs, RGB glow, live monitor, Sydney photo,
// posters, mug, dust and idle motion. main.js handles interaction.
//
// Room coordinates (y up, room.glb scaled 1.4x in main.js): floor y=-0.37, desk top y≈1.09,
// left wall x≈-3.92 (TV, shelves, clock), back wall z≈-3.92 (desk, door, frames). Camera looks in from +x/+z.
// Room node names lose their dots in three.js ('Cube.004_3' -> 'Cube004_3').

// Happy Hues palette 13 (same as the CSS tokens in style.css)
const PALETTE = { ink: '#0f0e17', paper: '#fffffe', slate: '#2e2f3e', grey: '#a7a9be', orange: '#ff8906', red: '#f25f4c', pink: '#e53170', wood: '#5c2c18' }

// Room materials recoloured to the palette: soft grey walls, dark wood floor, slate furniture/trim,
// coral seating, orange rug and accents. (The rug gets its own drawn texture, see drawRug.)
const PAINT = {
  Wall: '#d5d6df', // palette grey blended ~55% toward paper
  WallConcrete: PALETTE.slate, // outer rim and door frame
  MetalDoor: PALETTE.slate,
  PictureFrame: PALETTE.slate,
  Floor: PALETTE.wood, // tints the parquet texture, grain stays
  WoodenShelves: PALETTE.slate, // shelves, TV stand, desk top, coffee + side tables (texture dropped below)
  Armchair: PALETTE.red, // sofa, desk chair, side table top
  MousePad: PALETTE.orange,
  SlippersYellow: PALETTE.orange,
  Slippers: PALETTE.pink,
  'WallLamp.001': PALETTE.orange, // the lights toggle: stands out against the wall
}

// cover = material name of a room picture to paint the image over; otherwise a framed poster (w × h) at position.
const POSTERS = {
  posterPaper: { image: '/decor/paper.jpg', cover: 'Picture2' }, // back wall, middle frame
  posterTrigun: { image: '/decor/trigun.jpg', w: 1.04, h: 1.6, position: [2.85, 2.3, -4.03], rotationY: 0 }, // on the door
}

// Desktop "apps" on the monitor, in screen pixels (1024×576). id = which window opens in the zoomed-in desktop (#desktop in index.html).
const APPS = [
  { label: 'Voxel Engine', icon: '🧊', id: 'voxel' },
  { label: 'PictoPy', icon: '🖼️', id: 'pictopy' },
  { label: 'RPRMS', icon: '📈', id: 'rprms' },
  { label: 'Kiwix', icon: '📚', id: 'kiwix' },
  { label: 'Portfolio', icon: '🏠', id: 'portfolio' },
].map((a, i) => ({ ...a, x: 36 + (i % 2) * 120, y: 36 + Math.floor(i / 2) * 118, w: 96, h: 104 })) // two columns, like #desktop .icons

const TERMINAL = [
  '$ whoami',
  'rugved — software engineer, Sydney',
  '$ ls ~/projects',
  'voxel-engine  pictopy  rprms  kiwix  portfolio',
  '$ cat now.txt',
  'MPE (Software) @ University of Sydney',
  '$ ./open --hint',
  '← click an app to explore',
]

export function dressRoom({ scene, room, pc, spike, mp3, neon, mug }) {
  const state = { night: 0 } // 0 = day, 1 = night; tweened by main.js. RGB lights only come on at night (wall lamp click)
  const objects = {} // named clickable decor for HOTSPOTS
  const animated = [] // (t, dt) => void
  // One colour cycle (orange -> red -> pink, every 4s) for every glow in the room except the spike and the lights lamp.
  const rgb = new THREE.Color()
  const rgbStops = [PALETTE.orange, PALETTE.red, PALETTE.pink].map((c) => new THREE.Color(c))
  animated.push((t) => {
    const k = (t * 0.75) % 3
    rgb.lerpColors(rgbStops[Math.floor(k)], rgbStops[(Math.floor(k) + 1) % 3], k % 1)
  })
  const meshWith = (name, node = room) => { let found; node.traverse((m) => m.isMesh && m.material.name === name && !found && (found = m)); return found }
  const byMaterial = (name) => meshWith(name)

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

  // ---------- matte + shadows ----------
  const rugTex = canvasTexture(512, 512, drawRug)
  room.getObjectByName('Plane_84').traverse((m) => m.isMesh && (m.userData.shell = true)) // walls + outer rim
  room.traverse((m) => {
    if (!m.isMesh) return
    // the model's baked tangents make NaN pixels with its normal maps, which bloom smears over the whole frame;
    // without them three.js derives tangents in the shader
    m.geometry.deleteAttribute('tangent')
    // matte floor and wood: drop the gloss map (it multiplies roughness back down) and most of the env reflection
    if (m.material.name === 'WoodenShelves') m.material.map = null // solid slate furniture
    if (m.material.name === 'Carpet') Object.assign(m.material, { map: rugTex }).color.set('#fff')
    if (m.material.name === 'GlassEevee') Object.assign(m.material, { metalness: 0, roughness: 0.1, opacity: 0.3 }).color.set(PALETTE.paper) // clear, not mirrored
    if (m.material.name === 'Floor' || m.material.name === 'WoodenShelves') Object.assign(m.material, { roughnessMap: null, metalnessMap: null, roughness: 1, metalness: 0, envMapIntensity: 0.35, needsUpdate: true })
    if (PAINT[m.material.name]) m.material.color.set(PAINT[m.material.name])
    m.castShadow = !m.userData.shell // the walls would block the sun from outside; everything else casts
    m.receiveShadow = true
  })
  room.updateMatrixWorld(true)

  // ---------- bias lighting at night: LED strips + spotlights washing the wall behind the desk, TV and shelves ----------
  const biasMat = new THREE.MeshStandardMaterial({ color: 0x000000 })
  const washes = []
  // size = strip box (omit for no visible strip); from/to = spotlight position and where it points (on the wall)
  const wash = ({ strip, size, from, to, angle = Math.PI / 3, power = 12 }) => {
    if (strip) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(...size), biasMat)
      led.position.set(...strip)
      scene.add(led)
    }
    const light = new THREE.SpotLight(0xffffff, 0, 5, angle, 1, 1.5)
    light.position.set(...from)
    light.target.position.set(...to)
    light.userData.power = power
    scene.add(light, light.target)
    washes.push(light)
  }
  wash({ strip: [-1.92, 1.12, -3.89], size: [3.8, 0.03, 0.03], from: [-1.92, 1.15, -3.6], to: [-1.92, 3.1, -3.92] }) // desk (DESK in main.js), up the wall
  wash({ from: [-3.6, 1.56, 1.87], to: [-3.92, 1.56, 1.87], angle: Math.PI / 2.6, power: 8 }) // behind the TV: halo around it
  wash({ strip: [-3.5, 3.66, 0.16], size: [0.03, 0.03, 1.1], from: [-3.6, 3.68, 0.16], to: [-3.92, 5.2, 0.16], power: 10 }) // top of the shelves, up the wall
  animated.push(() => {
    biasMat.emissive.copy(rgb)
    biasMat.emissiveIntensity = 1.4 * state.night // keep near the bloom threshold so it glows without flaring
    for (const l of washes) {
      l.color.copy(rgb)
      l.intensity = l.userData.power * state.night
      l.visible = l.intensity > 0 // lights at 0 still cost every pixel
    }
  })

  // ---------- PC (props.pc): glass case, RGB fans that spin and glow ----------
  pc.traverse((m) => {
    if (!m.isMesh) return
    m.castShadow = !m.material.transparent // glass would shade the parts behind it
    if (m.material.name === 'mat24') Object.assign(m.material, { opacity: 0.12, roughness: 0.15 }) // case glass: clearer so the parts show
    m.receiveShadow = true
  })
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
  // the room's keyboard, mouse and speakers cycle with the fans
  const rgbMeshes = [...fanRings]
  room.traverse((m) => m.isMesh && ['CaseRgb', 'MouseLit', 'YellowSpeakerLit'].includes(m.material.name) && rgbMeshes.push(m))
  animated.push((t, dt) => {
    // read .material each frame: clickable meshes get cloned materials in main.js
    for (const m of rgbMeshes) {
      if (m.userData.hover) continue
      m.material.emissive.copy(rgb)
      m.material.emissiveIntensity = 1.2 * state.night
    }
    for (const b of fanBlades) b.rotation.x += dt * 9
    pcLight.color.copy(rgb)
    pcLight.intensity = 1.8 * state.night
    pcLight.visible = pcLight.intensity > 0
  })

  // ---------- monitors: live projects desktop on the main one, socials on the angled one to its left ----------
  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = screenCanvas.height = 1024 // drawn 1024×576, stretched to the square texture; up close the HTML page takes over
  const screenTex = new THREE.CanvasTexture(screenCanvas)
  screenTex.colorSpace = THREE.SRGBColorSpace
  screenTex.anisotropy = 8 // seen at a slant from the default view
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 })
  screenMat.name = 'screen'
  const screenMesh = planeOver(meshWith('ScreenOff', room.getObjectByName('Cube005_5')), screenMat)
  const socialsTex = canvasTexture(1024, 1024, drawSocials)
  const socialsMat = new THREE.MeshStandardMaterial({ map: socialsTex, emissiveMap: socialsTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 })
  const socialsMesh = planeOver(meshWith('ScreenOff', room.getObjectByName('Cube006_6')), socialsMat)
  let lastDraw = -1
  animated.push((t) => {
    if (t - lastDraw < 0.1) return // ~10 redraws/s: enough for the typing terminal
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

  // ---------- TV: the Mr. Robot GIF (source-assets/media), stored as a vertical strip of its 8 frames, 2s each ----------
  const TV_FRAMES = 8
  const tvTex = new THREE.TextureLoader().load('/decor/mr-robot.webp')
  tvTex.colorSpace = THREE.SRGBColorSpace
  tvTex.repeat.set(1, 1 / TV_FRAMES)
  const tvMesh = planeOver(byMaterial('TVScreenMovie'), new THREE.MeshStandardMaterial({ map: tvTex, emissiveMap: tvTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3 }))
  animated.push((t) => (tvTex.offset.y = 1 - ((Math.floor(t / 2) % TV_FRAMES) + 1) / TV_FRAMES)) // frame 0 is the top of the strip

  // screens glow on their own; hover highlight resets emissive, so restore it (read .material: main.js clones it)
  animated.push(() => {
    for (const m of [screenMesh, socialsMesh, tvMesh]) if (!m.userData.hover) m.material.emissive.setHex(0xffffff)
  })

  // ---------- window on the left wall: Sydney photos, day + night ----------
  // The wall has no opening, so it's a frame + faint glass over the photos. Photos: see the credits dialog.
  const WIN = { z: -2.2, y: 3.3, w: 2.6, h: 2.2 } // centre on the left wall (x -3.92); clear of the monitors and the moved lamp
  const win = new THREE.Group()
  win.position.set(-3.92, WIN.y, WIN.z)
  win.rotation.y = Math.PI / 2 // local +z points into the room
  const skyGeo = new THREE.PlaneGeometry(WIN.w, WIN.h)
  const daySky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial())
  const nightSky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }))
  daySky.position.z = 0.01
  nightSky.position.z = 0.012
  loadImageInto(daySky, '/decor/sydney-day.jpg', WIN.w / WIN.h)
  loadImageInto(nightSky, '/decor/sydney-night.jpg', WIN.w / WIN.h)
  const glass = new THREE.Mesh(skyGeo, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false }))
  glass.position.z = 0.07
  win.add(daySky, nightSky, glass)
  const frameMat = new THREE.MeshStandardMaterial({ color: PALETTE.slate, roughness: 0.6 }) // matches the door and picture frames
  const bar = (w, h, x, y, d = 0.14) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat)
    m.position.set(x, y, d / 2)
    m.castShadow = true
    win.add(m)
  }
  const t = 0.12 // frame thickness
  bar(WIN.w + 2 * t, t, 0, WIN.h / 2 + t / 2)
  bar(WIN.w + 2 * t, t, 0, -WIN.h / 2 - t / 2)
  bar(t, WIN.h, -WIN.w / 2 - t / 2, 0)
  bar(t, WIN.h, WIN.w / 2 + t / 2, 0)
  bar(0.07, WIN.h, 0, 0, 0.1) // centre mullion
  scene.add(win)
  objects.sydney = win
  animated.push(() => (nightSky.material.opacity = state.night))

  // ---------- family photos: drop them at these paths and they replace the art in the frames beside the paper ----------
  for (const [picture, url] of [['Picture3', '/decor/family-1.jpg'], ['Picture1', '/decor/family-2.jpg']]) {
    const photo = planeOver(byMaterial(picture), new THREE.MeshStandardMaterial({ roughness: 0.8 }))
    photo.visible = false // until the image loads; the frame's own art shows meanwhile
    loadImageInto(photo, url, rectOf(photo).w / rectOf(photo).h)
  }

  // ---------- manga on the tall bookshelf (left wall): favourite series, filled shelf by shelf in this order ----------
  // vols = how many volumes to shelve; colours from the palette. Spines face the room (+x).
  const { ink, paper, slate, grey, orange, red, pink } = PALETTE
  const MANGA = [
    { title: 'BERSERK', vols: 7, bg: ink, fg: red, band: red },
    { title: 'VINLAND SAGA', vols: 6, bg: paper, fg: slate, band: orange },
    { title: 'THE CLIMBER', vols: 4, bg: slate, fg: paper, band: grey },
    { title: 'ALICE IN BORDERLAND', vols: 4, bg: red, fg: paper, band: ink },
    { title: '20TH CENTURY BOYS', vols: 4, bg: paper, fg: red, band: slate },
    { title: 'SLAM DUNK', vols: 4, bg: orange, fg: ink, band: paper },
    { title: 'HAJIME NO IPPO', vols: 4, bg: paper, fg: ink, band: red },
    { title: 'VAGABOND', vols: 4, bg: ink, fg: paper, band: grey },
    { title: 'KINGDOM', vols: 4, bg: slate, fg: orange, band: orange },
    { title: 'MONSTER', vols: 4, bg: paper, fg: ink, band: pink },
    { title: 'OYASUMI PUNPUN', vols: 4, bg: paper, fg: pink, band: pink },
    { title: 'BLUE PERIOD', vols: 4, bg: slate, fg: paper, band: pink },
    { title: 'ATTACK ON TITAN', vols: 4, bg: grey, fg: ink, band: red },
    { title: 'TOKYO GHOUL', vols: 4, bg: paper, fg: ink, band: red },
    { title: 'TOKYO GHOUL:RE', vols: 4, bg: ink, fg: paper, band: red },
  ]
  // shelf tops measured from the model: left unit then right unit (the model's own books are removed in main.js)
  const SHELVES = [
    ...[0.22, 0.77, 1.35, 1.82, 2.62].map((y) => ({ y, z: [-0.36, 0.11] })),
    ...[0.05, 0.73, 1.53, 2.01, 2.59].map((y) => ({ y, z: [0.21, 0.68] })),
  ]
  const BOOK = { t: 0.055, d: 0.22, gap: 0.004 } // thickness (along z), depth (along x); height varies by series
  // All books are merged into one mesh (one draw call instead of 6 per book): spines come from one atlas of
  // 64×320 cells, the other faces from a white corner of it, coloured per vertex (pages / series cover colour).
  const ATLAS = { cols: 16, cell: [64, 320] }
  const atlas = document.createElement('canvas')
  atlas.width = ATLAS.cols * ATLAS.cell[0]
  atlas.height = 5 * ATLAS.cell[1] + 8 // 5 rows of spines (80 books max) + a white strip at the bottom
  const ac = atlas.getContext('2d')
  ac.fillStyle = '#fff'
  ac.fillRect(0, 0, atlas.width, atlas.height)
  const white = [2 / atlas.width, 2 / atlas.height] // uv of a white pixel (bottom strip; uv y runs up)
  const pages = new THREE.Color('#efe6d2')
  const books = []
  let shelf = 0
  let z = SHELVES[0].z[0]
  shelving: for (const [n, series] of MANGA.entries()) {
    const h = 0.28 + (n % 3) * 0.015 // real series differ a little in height
    const cover = new THREE.Color(series.bg)
    for (let vol = 1; vol <= series.vols; vol++) {
      if (z + BOOK.t > SHELVES[shelf].z[1]) {
        if (!SHELVES[++shelf]) break shelving // out of shelf space
        z = SHELVES[shelf].z[0]
      }
      const [col, row] = [books.length % ATLAS.cols, Math.floor(books.length / ATLAS.cols)]
      const [cw, ch] = ATLAS.cell
      ac.save()
      ac.translate(col * cw, row * ch)
      drawSpine(ac, cw, ch, series, vol)
      ac.restore()
      const geo = new THREE.BoxGeometry(BOOK.d, h, BOOK.t) // 4 vertices per face: +x -x +y -y +z -z
      const uv = geo.attributes.uv
      const colors = []
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4)
        if (face === 0) uv.setXY(i, ((col + uv.getX(i)) * cw) / atlas.width, 1 - ((row + 1 - uv.getY(i)) * ch) / atlas.height) // spine
        else uv.setXY(i, ...white)
        colors.push(...(face === 0 ? [1, 1, 1] : face < 4 ? pages.toArray() : cover.toArray()))
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geo.translate(-3.22 - BOOK.d / 2, SHELVES[shelf].y + h / 2, z + BOOK.t / 2)
      books.push(geo)
      z += BOOK.t + BOOK.gap
    }
  }
  const atlasTex = new THREE.CanvasTexture(atlas)
  atlasTex.colorSpace = THREE.SRGBColorSpace
  atlasTex.anisotropy = 4
  const manga = new THREE.Mesh(mergeGeometries(books), new THREE.MeshStandardMaterial({ map: atlasTex, vertexColors: true, roughness: 0.65 }))
  manga.castShadow = manga.receiveShadow = true
  scene.add(manga)
  objects.manga = manga

  // ---------- posters ----------
  for (const [key, p] of Object.entries(POSTERS)) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 })
    if (p.cover) {
      const art = planeOver(byMaterial(p.cover), mat)
      loadImageInto(art, p.image, rectOf(art).w / rectOf(art).h)
      objects[key] = art.parent // the frame node
      continue
    }
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

  // ---------- soft underglow on the floor around the sofa (as if from an LED strip under it) ----------
  const sofaBox = new THREE.Box3().setFromObject(room.getObjectByName('Cube012_19'))
  const floorBox = new THREE.Box3().setFromObject(byMaterial('Floor'))
  // glow rectangle = sofa footprint + pad, clipped to the floor so it never hangs past the room's open edges
  const pad = 0.3 // just enough room for the halo
  const x0 = Math.max(sofaBox.min.x - pad, floorBox.min.x), x1 = Math.min(sofaBox.max.x + pad, floorBox.max.x)
  const z0 = Math.max(sofaBox.min.z - pad, floorBox.min.z), z1 = Math.min(sofaBox.max.z + pad, floorBox.max.z)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, z1 - z0),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 512, (c, w, h) => {
        // White falloff (tinted by the shared rgb): many faint, ever-larger rounded rects around the sofa's footprint
        // stack into a smooth gradient (works in every browser, unlike ctx.filter).
        // Canvas x runs x0 -> x1, canvas y runs z0 -> z1 (the plane is laid flat facing up).
        const u = (x) => ((x - x0) / (x1 - x0)) * w
        const v = (z) => ((z - z0) / (z1 - z0)) * h
        const [l, r, t, b] = [u(sofaBox.min.x), u(sofaBox.max.x), v(sofaBox.min.z), v(sofaBox.max.z)]
        c.fillStyle = 'rgba(255,255,255,0.12)'
        for (let k = 8; k >= 0; k--) {
          const e = k * 1.8 // ~15px (about 0.12 units) past the sofa's edges
          c.beginPath()
          c.roundRect(l - e, t - e, r - l + 2 * e, b - t + 2 * e, 6 + e)
          c.fill()
        }
      }),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  glow.rotation.x = -Math.PI / 2
  glow.position.set((x0 + x1) / 2, floorBox.max.y + 0.02, (z0 + z1) / 2) // just above floor + carpet
  glow.raycast = () => {}
  scene.add(glow)
  animated.push(() => {
    glow.material.color.copy(rgb)
    glow.material.opacity = 0.2 + state.night * 0.5
  })

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

  // ---------- GSoC sticker on the back wall (text only, no Google logo) ----------
  const gsoc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.76),
    new THREE.MeshStandardMaterial({ map: canvasTexture(512, 340, drawGsocSticker), transparent: true, roughness: 0.6 }),
  )
  gsoc.position.set(2.85, 4.45, -3.9) // above the door
  gsoc.rotation.z = 0.06
  scene.add(gsoc)
  objects.gsoc = gsoc

  // ---------- neon sign: soft by day, bright with a little tube flicker at night, glowing in the shared rgb ----------
  const neonMeshes = []
  neon.traverse((m) => m.isMesh && neonMeshes.push(m))
  animated.push((t) => {
    const flicker = 1 - state.night * 0.08 * (Math.sin(t * 37) * Math.sin(t * 13) > 0.6 ? 1 : 0)
    for (const m of neonMeshes) {
      if (m.userData.hover) continue
      m.material.emissive.copy(rgb) // also restores it after the hover highlight
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

  // ---------- desk chair sways a little (the right one; the left one isn't grouped in the model) ----------
  const chair = room.getObjectByName('Cylinder022_105')
  const chairPivot = new THREE.Group()
  new THREE.Box3().setFromObject(chair).getCenter(chairPivot.position)
  scene.add(chairPivot)
  chairPivot.attach(chair)
  animated.push((t) => (chairPivot.rotation.y = Math.sin(t * 0.4) * 0.12))

  // ---------- wall lamp (the lights toggle): warm glow at night, a gentle breathe by day so it's easy to spot ----------
  const lampMeshes = []
  room.traverse((m) => m.isMesh && m.material.name === 'WallLamp.001' && lampMeshes.push(m))
  animated.push((t) => {
    // lamp meshes are cloned for hover highlight later, so read .material each frame
    for (const m of lampMeshes) {
      if (m.userData.hover) continue
      m.material.emissive.set(PALETTE.orange)
      m.material.emissiveIntensity = state.night * 0.08 + (1 - state.night) * (0.07 + Math.sin(t * 3) * 0.05)
    }
  })

  return {
    state,
    objects,
    screenMesh,
    screens: { projects: rectOf(screenMesh), socials: rectOf(socialsMesh) }, // keys = data-screen in index.html
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
// aspect (w/h of the mesh): crop the image to fill it without stretching, like CSS object-fit: cover
function loadImageInto(mesh, url, aspect) {
  new THREE.TextureLoader().load(url, (img) => {
    img.colorSpace = THREE.SRGBColorSpace
    const a = img.image.width / img.image.height
    if (aspect && a > aspect) {
      img.repeat.set(aspect / a, 1)
      img.offset.set((1 - aspect / a) / 2, 0)
    } else if (aspect && a < aspect) {
      img.repeat.set(1, a / aspect)
      img.offset.set(0, (1 - a / aspect) / 2)
    }
    mesh.material.map = img
    mesh.material.needsUpdate = true
    mesh.visible = true
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

// The socials monitor as seen from across the room (the real links are the #socials page when zoomed in).
function drawSocials(c) {
  c.setTransform(1, 0, 0, 1024 / 576, 0, 0) // draw in 1024×576, stretched to the square texture
  const bg = c.createLinearGradient(0, 0, 1024, 576)
  bg.addColorStop(0, PALETTE.ink)
  bg.addColorStop(1, PALETTE.slate)
  c.fillStyle = bg
  c.fillRect(0, 0, 1024, 576)
  c.fillStyle = PALETTE.paper
  c.font = '700 44px system-ui, sans-serif'
  c.fillText('Find me online', 64, 110)
  ;[['🐙', 'GitHub'], ['💼', 'LinkedIn'], ['✉️', 'Email'], ['🎧', 'Spotify']].forEach(([icon, label], i) => {
    const x = 64 + i * 228
    c.fillStyle = PALETTE.ink
    roundRect(c, x, 170, 208, 240, 18)
    c.fillStyle = PALETTE.paper
    c.font = '64px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
    c.fillText(icon, x + 28, 260)
    c.font = '700 34px system-ui, sans-serif'
    c.fillText(label, x + 28, 330)
  })
  c.fillStyle = PALETTE.ink
  c.fillRect(0, 540, 1024, 36)
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

// A flat rectangular mesh (screen, picture) -> its rectangle in world space, facing into the room.
// right/up/normal are unit vectors; w/h are world sizes.
function rectOf(mesh) {
  mesh.updateMatrixWorld(true)
  const g = mesh.geometry
  const pos = g.attributes.position
  const pts = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld))
  // normal from the biggest triangle (exported meshes can start with a degenerate one)
  const at = (i) => pts[g.index ? g.index.getX(i) : i]
  const normal = new THREE.Vector3()
  for (let i = 0, n = new THREE.Vector3(); i < (g.index ?? pos).count; i += 3) {
    n.crossVectors(at(i + 1).clone().sub(at(i)), at(i + 2).clone().sub(at(i)))
    if (n.lengthSq() > normal.lengthSq()) normal.copy(n)
  }
  normal.normalize()
  const mid = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3())
  if (normal.dot(new THREE.Vector3(0, 2, 0).sub(mid)) < 0) normal.negate() // the room's middle is in front
  const right = new THREE.Vector3(0, 1, 0).cross(normal).normalize()
  const up = new THREE.Vector3().crossVectors(normal, right)
  const span = (axis) => { const d = pts.map((p) => p.dot(axis)); return [Math.min(...d), Math.max(...d)] }
  const [r0, r1] = span(right), [u0, u1] = span(up)
  const center = mid.clone().addScaledVector(right, (r0 + r1) / 2 - mid.dot(right)).addScaledVector(up, (u0 + u1) / 2 - mid.dot(up))
  return { center, normal, right, up, w: r1 - r0, h: u1 - u0 }
}

// A plane with uv 0..1 laid just in front of `mesh` and attached to its parent, so it's part of the same
// clickable object. Used where the model's own UVs only cover part of the surface.
function planeOver(mesh, material, lift = 0.003) {
  const r = rectOf(mesh)
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), material)
  plane.position.copy(r.center).addScaledVector(r.normal, lift)
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r.right, r.up, r.normal))
  mesh.parent.attach(plane)
  return plane
}

// A manga spine: colour band at the top, title running down, volume number at the bottom.
function drawSpine(c, w, h, series, vol) {
  c.fillStyle = series.bg
  c.fillRect(0, 0, w, h)
  c.fillStyle = series.band
  c.fillRect(0, 0, w, h * 0.07)
  c.save()
  c.translate(w / 2, h * 0.12)
  c.rotate(Math.PI / 2)
  c.fillStyle = series.fg
  c.font = 'bold 34px Impact, "Arial Black", sans-serif'
  c.textBaseline = 'middle'
  c.fillText(series.title, 0, 0, h * 0.68)
  c.restore()
  c.fillStyle = series.fg
  c.font = 'bold 28px system-ui, sans-serif'
  c.textAlign = 'center'
  c.fillText(vol, w / 2, h * 0.94)
}

// The carpet: ink border, orange field, three pink stripes.
function drawRug(c, w, h) {
  c.fillStyle = PALETTE.ink
  c.fillRect(0, 0, w, h)
  c.fillStyle = PALETTE.orange
  c.fillRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9)
  c.fillStyle = PALETTE.pink
  for (const y of [0.38, 0.5, 0.62]) c.fillRect(w * 0.05, h * y - 6, w * 0.9, 12)
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fill()
}

