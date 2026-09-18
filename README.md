# YAE Viewer

[English](README.md) · [Русский](README.ru.md)

A viewer for *You Are Empty* (2006) assets that runs in the browser: drop a model, a level, a
collision mesh or a navmesh from your own copy of the game onto the page and look at it with its
textures, lightmaps, skeleton and animations. Nothing is uploaded anywhere; the files are parsed in
your browser. Part of [Project Empty](https://github.com/OpenYAE).

**Live:** https://openyae.github.io/yae-viewer/ (published from this repository by GitHub Pages).

## What it opens

| Drop | Formats |
|---|---|
| Model or level | `.ds2md` (models with skeleton and animations), `.ds2` (level geometry), `.glb`, `.gltf` |
| Overlays | `.ds2cm`, `.ds2cm2` (collision mesh, with materials in v2), `.ds2aim` (AI navmesh) |
| Textures | `.png`, `.jpg`, `.tga`, `.dds`, and the level's lightmaps |

Where the files are in the game: models under `gameres/models/`, levels under `gameres/maps/`,
textures under `gameres/textures/`. The game's resources are not part of this repository.

## Running it locally

The page is three files, `index.html`, `styles.css` and `app.js`; three.js is loaded from a CDN
through the import map in `index.html`. ES modules do not load from `file://`, so serve the folder:

```bash
python3 -m http.server 8080      # then open http://localhost:8080/
```

## Where the code comes from

The viewer grew inside the [YAE SDK](https://github.com/OpenYAE/yae-sdk), where a frozen copy
(`viewer.html`) remains the behavioural reference the desktop editor's viewport is checked against.
This repository is the copy that keeps evolving as the public viewer. Its format parsers are a
self-contained copy; the maintained format library is `packages/formats` in the SDK, and the
specifications are in the [docs portal](https://github.com/OpenYAE/yae-docs).

## Roadmap

The next iteration is a UI pass, tracked in [TODO.md](TODO.md): one drop field for every file type,
the animation export and the test controls removed, and a new design.

## Legal

*You Are Empty* and its formats belong to their rights holders; the viewer contains no game assets
and works on the files of your own copy. The license of the viewer is being chosen by the
maintainers (MIT proposed); until a `LICENSE` file appears, all rights are reserved.
