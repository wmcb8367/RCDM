# RCDM Reader Versioning

## What is versioned now

The reader now has a human-editable deployment layer.

- `reader/config/deployment.json`
  - declares active text version
  - declares active audio version
  - declares whether deployment is `version-locked` or `mixed`
- `reader/content/<text-version>/book-manifest.json`
  - chapter map for the selected text edition
- `reader/audio-manifests/<audio-version>.json`
  - chapter-by-chapter audio mapping
  - source manuscript version for each track
  - provenance notes when uncertain

## Current seeded state

- Active text version: `v2.2`
- Active audio version: `coach-willie-2026-04-13-frontmatter-part1-v2.2`
- Deployment mode: `aligned`
- Confidence:
  - text provenance is high confidence
  - Preface, Prologue, and Part 1 audio provenance is high confidence
  - later sections remain text-only until recorded

The current deployment is aligned for the front matter through the end of Part 1, and explicit about what has not yet been recorded.

## How the reader works now

`reader/index.html` loads:

1. `reader/config/deployment.json`
2. the selected text script from `deployment.text.scriptPath`
3. the selected text manifest from `deployment.text.manifestPath`
4. the selected audio manifest from `deployment.audio.manifestPath`

The UI displays:

- text version in use
- audio version in use
- deployment mode
- warning copy when text/audio provenance is mixed or uncertain

## How to switch versions

### Switch text only

1. Add or generate the new text assets inside a versioned folder
   - `reader/content/<new-version>/book-manifest.json`
   - `reader/content/<new-version>/book-content.js`
2. Update `reader/config/deployment.json`
   - `text.activeVersion`
   - `text.manifestPath`
   - `text.scriptPath`
3. Leave audio settings alone if you intentionally want a mixed deployment

### Recommended rule

Do not point the reader at the old shared `reader/book-content.js` anymore.
Use a versioned path such as:
- `reader/content/v2.1/book-content.js`

That keeps every deployed manuscript traceable and prevents silent drift between the reader and the manuscript archive.

### Switch audio only

1. Add a new manifest in `reader/audio-manifests/<audio-version>.json`
2. Map each track to:
   - `chapterId`
   - `src`
   - `sourceTextVersion`
   - `provenanceNote` if needed
3. Update `reader/config/deployment.json`
   - `audio.activeVersion`
   - `audio.manifestPath`

### Lock text and audio to the same manuscript

When Willie chooses a final aligned pairing:

1. point both text and audio to the desired versions
2. ensure the audio manifest uses verified `sourceTextVersion` values
3. set `deploymentMode` to `version-locked`
4. remove or reduce the warning text if provenance is verified

There is a starter template at:
- `reader/audio-manifests/template-version-locked.json`

## Current live pairing

- Text source: `editions/markdown/RCDM-v2.2.md`
- Text manifest: `reader/content/v2.2/book-manifest.json`
- Audio manifest: `reader/audio-manifests/coach-willie-2026-04-13-frontmatter-part1-v2.2.json`
- Scope of aligned audio: Preface, Prologue, and all chapters in Part 1

## Recommended future content pipeline

1. Edit manuscript in `editions/markdown/RCDM-vX.Y.md`
2. Generate reader-ready HTML/JS for that manuscript
3. Create `reader/content/vX.Y/book-manifest.json`
4. If audio exists for that manuscript, create `reader/audio-manifests/<audio-version>.json`
5. Flip `reader/config/deployment.json` to the chosen pairing
6. Test locally, then publish to Pages

## Known unresolved uncertainty

- The current reader text appears to be `v2.1`
- The currently mapped audiobook files are real and usable
- Exact manuscript provenance for those audio files is still not fully verified
- Some files may have been recorded against a nearby draft rather than the final `v2.1` wording

That uncertainty is now explicit in config and in the UI instead of being hidden in file assumptions.
