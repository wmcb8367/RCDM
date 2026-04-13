# Race Course Decision Making (RCDM)

Interactive reader, manuscript editions, audiobook assets, and supporting source materials for *Race Course Decision Making* by William McBride.

## Live reader

GitHub Pages serves the reader from `reader/`:

- `https://wmcb8367.github.io/RCDM/reader/`

## Copyright

**Copyright © 2026 William McBride. All rights reserved.**

This repository is public for reading and reference. Public visibility does **not** grant permission to copy, redistribute, train on, republish, or create derivative works from the contents.

See `COPYRIGHT.md` for the full notice.

## Current deployment

The reader now loads its active text and audio from explicit deployment config.

Current target deployment:

- Player: `player-v1-puter-splash-v22`
- Text: `v2.2`
- Audio: `coach-willie-2026-04-13-frontmatter-part1-v2.2`
- Mode: `aligned` for Preface through the end of Part 1

This means:

- the **entire reader text** is deployed from `RCDM-v2.2.md`
- **Preface, Prologue, and all Part 1 chapter audio** are aligned to the edited `v2.2` manuscript
- later sections remain text-only until their chapter audio is generated

## Repo structure

- `reader/` - static web reader
- `reader/config/` - deploy-time version selection
- `reader/content/` - versioned reader manifests and scripts
- `reader/audio-manifests/` - audio version manifests and provenance
- `editions/markdown/` - manuscript history
- `editions/pdf/`, `editions/docx/`, `editions/epub/` - archived format exports
- `figures/` - figures, tables, and supporting artwork
- `docs/VERSIONING.md` - versioning and deployment workflow

## Version-aware deployment

Key files:

- `reader/config/deployment.json`
- `reader/content/v2.2/book-manifest.json`
- `reader/content/v2.2/book-content.js`
- `reader/audio-manifests/coach-willie-2026-04-13-frontmatter-part1-v2.2.json`
- `reader/audio-manifests/template-version-locked.json`
- `docs/VERSIONING.md`

## Editing and publishing workflow

1. Edit the manuscript in `editions/markdown/`
2. Generate or update versioned reader content in `reader/content/<version>/`
3. Add or update audio provenance in `reader/audio-manifests/`
4. Flip `reader/config/deployment.json` to the desired pairing
5. Test locally, then publish to GitHub Pages

See `docs/VERSIONING.md` for the full workflow.
