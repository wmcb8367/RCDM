# Race Course Decision Making (RCDM)

Interactive reader, manuscript editions, and audiobook assets for *Race Course Decision Making*.

## Live reader

GitHub Pages serves the reader from `reader/`.

## Version-aware deployment

The reader now loads its active text and audio from explicit config instead of hidden assumptions.

Key files:

- `reader/config/deployment.json`
- `reader/content/v2.1/book-manifest.json`
- `reader/audio-manifests/adam-2026-04-07-partial.json`
- `docs/VERSIONING.md`

Current seeded deployment:

- Text: `v2.1`
- Audio: `adam-2026-04-07-partial`
- Mode: `mixed`

The deployment is currently marked mixed because text provenance is clearer than audio provenance.

## Repo structure

- `reader/` - static web reader
- `reader/config/` - deploy-time version selection
- `reader/content/` - versioned reader manifests
- `reader/audio-manifests/` - audio version manifests and provenance
- `editions/markdown/` - manuscript history
- `docs/VERSIONING.md` - how to add/switch versions

## Switching versions

Edit `reader/config/deployment.json` and point it at the desired text and audio manifests.

See `docs/VERSIONING.md` for the full workflow.
