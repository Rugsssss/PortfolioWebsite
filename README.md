# Portfolio — Rugved Deshmukh

Interactive 3D room portfolio built with Vite + Three.js.

```
npm install
npm run dev      # http://localhost:5173  (?debug = prop placement sliders, ?night, ?plain)
npm run build    # static site in dist/
```

## Layout
- `index.html` — page shell and all section text (each `<dialog>` is a section)
- `src/main.js` — scene setup, props (`PROPS`), clickable hotspots (`HOTSPOTS`), camera, panels
- `src/decor.js` — room dressing: lighting, posters, monitor/MP3 screens, music, background shader
- `src/style.css` — palette tokens, frosted-glass panels
- `public/` — what the site serves: compressed models, images, music
- `api/now-playing.js` — optional Vercel function for live Spotify "now playing" (not wired up)
- `source-assets/` — original downloads the files in `public/` were made from; not served

Re-compress a model after editing its source:
`npx gltf-transform optimize source-assets/models/X.glb public/models/X.glb --texture-compress webp --texture-size 1024 --compress meshopt --join false --flatten false --instance false --palette false`

Third-party model, photo and music credits are in the Credits dialog in `index.html`.
