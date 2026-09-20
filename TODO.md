# TODO

Left out of the 2.0 rewrite on purpose (decided 2026-09-20):

- [ ] `.ds2edf` game-logic entities in the Objects tree (the SDK's "Gameplay" group with proxies) —
      needs the Lua-like parser from `sdk-desktop/packages/formats/src/ds2Edf.ts`.
- [ ] Editing keys in the timeline (it is read-only: the keys come from the file).
- [ ] `.glb`/`.gltf` in the file list (the old viewer opened them; the game's formats only now).
- [ ] Parse a level in a Web Worker (today ~1 s on the main thread for a 40 MB level, behind the
      loading card).
- [ ] Physics rigs (`.phs`/`.rds`) beside a model, as the SDK shows them.

Rules that stay: no game assets in the repository, no upload of the user's files anywhere.
