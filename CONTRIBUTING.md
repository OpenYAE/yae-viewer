# Contributing to YAE Viewer

Thanks for helping. The viewer is one part of [Project Empty](https://github.com/OpenYAE); the
ecosystem-wide rules (language policy, conventions on units, coordinates and colour) live in
the [project-empty](https://github.com/OpenYAE/project-empty) repository and the
[docs portal](https://github.com/OpenYAE/yae-docs). This file is what is specific to the viewer.

## Ground rules

- **No game assets in the repository.** Not a texture, not a level, not a test fixture cut from
  one. Tests and screenshots use the files of your own copy of the game, found through
  `YAE_ASSETS`.
- **Nothing leaves the browser.** The viewer reads the user's folder and parses it locally; do not
  add code that uploads, fetches or reports the user's files anywhere.
- **The formats belong to the SDK.** `src/formats/` is a port of `sdk-desktop/packages/formats` of
  the [YAE SDK](https://github.com/OpenYAE/yae-sdk). A reading of the bytes that differs from the
  SDK's is either a bug there (fix it in the SDK and port the fix) or a bug here — never a
  viewer-only reading. The engine's conformance gate (`scripts/conformance.sh` in the engine
  repository) is the arbiter between the two.
- **The picture follows the engine.** Conventions that were verified against the game — Z-up data
  under one Y-up rotation, textures uploaded unflipped and sampled with the authored UVs, bones and
  keys used verbatim, `diffuse × lightmap × 2` in display space for the DS2 render mode — are the
  [YAE Engine](https://github.com/OpenYAE/yae-engine)'s (`docs/Invariants.md` there). Change them
  only with a measurement against the game, and say which.
- Code, comments and commit messages are in English. The READMEs are kept in three languages;
  a change to one is a change to all three.

## Setting up

```bash
npm ci
npm run dev        # http://localhost:5180/yae-viewer/
npm run build      # tsc --noEmit + vite build → dist/   (what the Pages workflow runs)
npm run preview    # serve dist/
```

Node 20. The site is built for `/<repository>/` (`VITE_BASE`); the PWA manifest and the service
worker come from `vite.config.ts`.

## Checking a change

1. `npm run build` must pass: it type-checks with `strict`, `noUnusedLocals` and
   `noUnusedParameters` on, then bundles.
2. Open the change in a browser with real game files: at least one level (`med1` is the reference:
   4 455 meshes, one lightmap page, a v2 collision, a rebuilt navmesh, 93 lights) and one skinned
   model with animations (`fireman`, `ded`, `dog` — the dog's bind pose is 36× its animated scale
   and its faces wind the other way, so it catches skinning mistakes the others do not).
3. For anything that touches rendering, loading or the trees, run the headless smoke and look at
   the screenshots it writes:

   ```bash
   npm i -D playwright && npx playwright install chromium   # once
   npm run build && YAE_ASSETS=/path/to/gameres npm run smoke [file …]
   ```

   It serves `dist/`, opens the viewer in Chromium (SwiftShader WebGL), feeds it the folder through
   the `window.__yaeOpenFiles` hook and screenshots each opened file into `smoke-out/`; any page
   error fails it. `window.__yae` is the engine, for ad-hoc probes from the console.

## Layout

```
src/formats/   the parsers (port of the SDK's format library)
src/fs/        folder access: File System Access API, the <input webkitdirectory> fallback, drops, the catalog
src/scene/     three.js: asset loading, level and model builders, materials per render mode, overlays, the engine
src/state/     the zustand store and the shared types
src/ui/        React: the three columns, the trees, the player and the timeline
scripts/       the headless smoke
docs/          screenshots for the README
```

Keep a change in the layer it belongs to: a new file format goes to `src/formats/` with a test on
a synthetic fixture (see the SDK's `test_*.ts` for the style), a new overlay to `src/scene/overlays.ts`,
a new panel to `src/ui/`. The store holds only what React renders; three.js objects stay in the
engine.

## Submitting

- One change per pull request, with what was measured in the description (which level or model,
  what it looked like before and after — a screenshot from the smoke is ideal).
- If the change alters what the user sees or can do, update the three READMEs.
- If it defers something, add it to `TODO.md` with the reason.
