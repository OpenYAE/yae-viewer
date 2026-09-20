# YAE Viewer

[English](README.md) · [Русский](README.ru.md) · [Українська](README.uk.md)

A browser viewer for the assets of *You Are Empty* (2006) and *Instinct* (2007): point it at the
folder with the unpacked game files and look at the levels with their lightmaps, collisions and
navigation grid, and at the models - with their skeleton and animations. Nothing is uploaded
anywhere; everything is read and parsed in the browser. Part of
[Project Empty](https://github.com/OpenYAE).

**Live:** https://openyae.github.io/yae-viewer/ (published from this repository by GitHub Pages).
It installs as a PWA and works offline once opened.

![The parall level with its lightmaps in the DS2 render mode, the Objects tree grouped by material](docs/screenshots/level-parall.png)

![The budyonovets model with its skeleton, the clip list and the animation player](docs/screenshots/model-budyonovets.png)

## How to use it

1. **Add folder** - choose the folder with the unpacked game resources (`gameres`, or any folder
   with `maps/`, `models/`, `textures/`, `materials/`). Chromium browsers ask for read access once
   and remember the folder under *Open recent*; other browsers read the folder through the usual
   file dialog. A folder, a level or a model can also be dropped into the viewport.
2. **File list** shows only what the viewer opens - `.ds2` levels and `.ds2md` models - in their
   folders. Everything that belongs with a file is found on its own: the `.ds2cm2`/`.ds2cm`
   collision, the `.ds2aim` navigation grid (`_rebuilded` preferred, as the game loads it), the
   `<level>_lm_N.tga` lightmap pages, the `.mat` material templates and every texture the meshes
   name (`textures/**/*.dds`, `.tga`).
3. The open file unfolds into a list of its contents. Clicking a row selects the objects in the
   **Objects** tree.  
   Several objects can be selected, framed (`F` or double-click), hidden and filtered.  
   Models also have **Skeleton**, **Transform** and **Animations**.
4. The player under the viewport plays a clip; the timeline button opens the dope sheet - the
   selected bone's tracks first, then every animated bone - with a playhead, key stepping, onion
   skin and snap-to-frame. The keys are read from the file and are not editable.

### Viewport controls
- Orbit - mouse  
- Fly - `WASD` / `QE` (Shift - faster)  
- Select - click, frame - double-click  
- Camera presets: `0` (perspective), `7` (top), `1` (front), `3` (left), `Home` - reset  

### Render modes
**DS2 Render** (the game's picture: diffuse × lightmap × 2, or diffuse × vertex light × 2, in display space), 
**Lit** (the level's lights through three.js), Albedo, Normals, Lightmap, UV checker, Wireframe.  
The settings toggle lightmaps, lights, shadows, navmesh, collision, the grid and the skeleton gizmos,
and load an HDR background (`.exr`/`.hdr` - the **Load HDR** button, or drop the file into the viewport).

### Supported formats
`.ds2` (level geometry, version 0.8), `.ds2md` (models 1.0 and the legacy 0.6),
`.ds2cm`/`.ds2cm2`, `.ds2aim`, `.mat`, `.dds` (DXT1/3/5, decoded in software where the GPU has no
S3TC), `.tga`, `.png`/`.jpg`.


## Development

```bash
npm ci
npm run dev        # Vite dev server on http://localhost:5180/yae-viewer/
npm run build      # type check + build into dist/
npm run preview    # serve dist/
```

`VITE_BASE` sets the path the site is built for (the Pages workflow passes `/<repository>/`).

## Where the code comes from

Parsers - a port of the format library of the [YAE SDK](https://github.com/OpenYAE/yae-sdk)

The DS2 Render colour pipeline - [YAE Engine](https://github.com/OpenYAE/yae-engine)

Specifications - in the [documentation portal](https://github.com/OpenYAE/yae-docs)

## Contributing

How to build, check and submit a change - in [CONTRIBUTING.md](CONTRIBUTING.md).

## Legal

*You Are Empty*, *Instinct* and their formats belong to their rights holders; the viewer contains no
game assets and works on the files of your own copy. The viewer's code is under the
[MIT](LICENSE) license.
