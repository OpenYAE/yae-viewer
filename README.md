# YAE Viewer

[English](README.md) · [Русский](README.ru.md)

A viewer for *You Are Empty* (2006) assets that runs in the browser: point it at the unpacked game
files and look at the levels with their lightmaps, collision meshes and navigation grids, and at the
models with their skeletons and animations. Nothing is uploaded anywhere — the files are read and
parsed in your browser. Part of [Project Empty](https://github.com/OpenYAE).

**Live:** https://openyae.github.io/yae-viewer/ (published from this repository by GitHub Pages).
It installs as a PWA and works offline once opened.

![The parall level with its lightmaps in the DS2 render mode, the Objects tree grouped by material](docs/screenshots/level-parall.png)

![The budyonovets model with its skeleton, the clip list and the animation player](docs/screenshots/model-budyonovets.png)

## Using it

1. **Add folder** — choose the folder with the unpacked game resources (`gameres`, or any folder
   that holds `maps/`, `models/`, `textures/`, `materials/`). Chromium browsers ask for read access
   once and remember the folder under *Open recent*; other browsers read the folder through the
   classic file picker. A folder, a level or a model can also be dropped into the viewport.
2. The **File list** shows only the files the viewer opens — `.ds2` levels and `.ds2md` models —
   with the folder tree they sit in. Everything a file needs is found on its own: the level's
   `.ds2cm2`/`.ds2cm` collision, its `.ds2aim` navigation grid (`_rebuilded` preferred, as the game
   loads it), its `<level>_lm_N.tga` lightmap pages, the `.mat` material templates and every texture
   the meshes name (`textures/**/*.dds`, `.tga`).
3. The open file unfolds in the list into what it holds (meshes, lightmaps, lights, …); each row
   leads to the matching group of the **Objects** tree in the inspector. The tree is the SDK's
   Hierarchy panel without the editing: select (click, Ctrl for several, Shift for a range), frame
   (double-click or `F`), hide with the eye (`h`), filter with the search field. **Skeleton** lists a
   model's bones; the **Transform** card follows the selection; **Animations** lists the clips.
4. The player under the viewport plays a clip; the timeline button opens the dope sheet — the
   selected bone's tracks first, every animated bone after — with a draggable playhead, key
   stepping, onion skin and snap-to-frame. The keys are read from the file and are not editable.

Viewport: orbit with the mouse, `WASD`/`QE` to fly (Shift faster), click to select, double-click to
frame. Camera presets in the top-left dropdown (`0` perspective, `7` top, `1` front, `3` left,
`Home` reset). Render modes: **DS2 Render** (the game's picture: diffuse × lightmap × 2, or diffuse ×
vertex light × 2, in display space), **Lit** (the level's lights through three.js), Albedo, Normals,
Lightmap, UV checker, Wireframe. Display settings toggle lightmaps, lights, shadows, navmesh,
collision, bounding boxes, the grid (its step in metres, 64 units = 1 m) and the skeleton gizmos.

Supported: `.ds2` (level geometry, version 0.8), `.ds2md` (models 1.0 and the legacy 0.6),
`.ds2cm`/`.ds2cm2`, `.ds2aim`, `.mat`, `.dds` (DXT1/3/5, decoded in software where the GPU lacks
S3TC), `.tga`, `.png`/`.jpg`.

## Development

```bash
npm ci
npm run dev        # Vite dev server on http://localhost:5180/yae-viewer/
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
```

`VITE_BASE` sets the path the site is built for (the Pages workflow passes `/<repository>/`).

## Where the code comes from

The parsers under `src/formats/` are a port of the format library of the
[YAE SDK](https://github.com/OpenYAE/yae-sdk) (`sdk-desktop/packages/formats`), with two readings
taken from the engine's conformance pass: a `.ds2cm2` face's material is its fifth word, and an
animation header of type N is followed by N−1 extra words. The rendering conventions — Z-up data
under one Y-up rotation, textures uploaded unflipped and sampled with the authored UVs, bones and
keys used verbatim, the colour pipeline of the DS2 render mode — follow the
[YAE Engine](https://github.com/OpenYAE/yae-engine), which is checked against the game picture by
picture. The specifications live in the [docs portal](https://github.com/OpenYAE/yae-docs).

## Legal

*You Are Empty* and its formats belong to their rights holders; the viewer contains no game assets
and works on the files of your own copy. The license of the viewer is being chosen by the
maintainers (MIT proposed); until a `LICENSE` file appears, all rights are reserved.
