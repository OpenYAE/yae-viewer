# TODO — the UI iteration

Agreed on 2026-09-19; the detailed list follows from the maintainer.

- [ ] One drop field for every file type (model, level, overlays, textures, lightmaps) instead of
      the separate model and texture zones; detect the type by extension and by magic.
- [ ] Remove the animation export.
- [ ] Remove the test controls (the transform sliders used to align navmesh and model by hand,
      the lightmap-UV range logging, the UV preview) or move them behind a "developer" toggle.
- [ ] New visual design (a design will be provided; until then keep the current dark glass look).
- [ ] Split `app.js` further only if the design pass needs it; today it is the parsers plus the
      scene in one module, as in the SDK's frozen `viewer.html`.

Rules that stay: no game assets in the repository, no upload of the user's files anywhere, the
page must keep working as three static files behind any web server.
