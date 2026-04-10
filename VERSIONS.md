# RCDM Versions

## Comparison Table

| Version | Repo path | Format | Approx. words | Date observed | Pages | Figures | Notes |
| --- | --- | --- | ---: | --- | ---: | --- | --- |
| RCDM v2.1 | `editions/RCDM-v2.1.md` | Markdown | 55,077 | 2026-04-06 file timestamp | n/a | Yes | Most structured source text in repo, with full heading hierarchy and 2025 edition front matter. |
| RCDM v2 Draft 2 | `editions/RCDM-v2-DRAFT2.pdf` | PDF | 50,642 | 2026-02-23 file timestamp | 132 | Yes | Earlier rough-draft PDF. Preface explicitly calls it a rough draft. |
| RCDM v2 | `editions/RCDM-v2.pdf` | PDF | 54,159 | 2026-04-08 file timestamp | 138 | Yes | Later PDF received from Willie. Text closely matches the v2.1 / reader generation and is more complete than Draft 2. |
| Reader HTML source | `reader/book-content.html` | HTML fragment | 53,210 | 2026-04-07 file timestamp | n/a | Yes | HTML-rendered book body used by the interactive reader. |
| Reader JS source | `reader/book-content.js` | JS-embedded HTML/text payload | 53,206 | 2026-04-07 file timestamp | n/a | Yes | JavaScript-packed reader content, effectively the same manuscript family as the HTML reader source. |
| Narration script | `narration/RCDM-narration-script.txt` | Plain text | 52,838 | 2026-04-08 file timestamp | n/a | Mostly no | Clean narration-oriented export of the book text, optimized for voice work rather than page layout. |
| Course outline | `curriculum/RCDM-Course-Outline.md` | Markdown | 685 | 2026-02-23 file timestamp | n/a | No | Companion curriculum outline mapping book sections to a 12-unit course. |

## File identity notes

- `editions/RCDM-v2-DRAFT2.pdf` is byte-for-byte identical to `/Users/mcbrideagents/.openclaw/workspace/projects/rcdm-curriculum/RCDM-v2-DRAFT2.pdf`.
- SHA-256 for both Draft 2 PDF copies: `6f6ce8d45e72841202fc27a4edf18e5edc9ffa1e413966daa72bf60e22777a30`
- SHA-256 for `editions/RCDM-v2.pdf`: `3935d2604503c5bef4e4110ef8811666e0f58da6eb43068b50c7792a14baae38`

## Shared chapter structure across the main book editions

The Markdown manuscript, later PDF, reader sources, and narration script all track the same core structure:

1. Preface
2. Prologue: The Education of a Coach
3. Introduction
   - Introduction To Race Course Decision Making
   - Overview of Race Course Philosophy Tactics and Strategy
   - The Three Building Blocks Of Race Course Decision Making
   - Building A Process For Learning Race Course Decision Making
4. I. Race Course Philosophy
   - What Is Race Course Philosophy?
   - What We Know About The Starting Line
   - First Beat Fundamentals
   - Weather Mark Layline Management
   - 9 Ways To Pass Boats Downwind
   - The Downwind Decision Diamond
   - Downwind Philosophy Of Symmetrical Spinnaker Boats
   - The Evolution of Race Course Philosophy
5. II. Strategy
   - What is Strategy?
   - Making Your Bet: The Game Of Odds
   - 5 Types of Day
   - Spirit Animals Of the Five Types Of Day
6. III. Tactics
   - What Are Tactics?
   - Tactics of Connect The Dots
   - Tactics of The Inside Track
   - UW 6
   - UW 7
   - Tactics of The Edge Out Strategy
   - Tactics of the Outside Track
   - Tactical Summary
7. Conclusion: Balancing Race Course Philosophy, Strategy and Tactics
   - When The Unconscious Becomes Conscious

## Detailed notes by version

### 1. `editions/RCDM-v2.1.md`
- Most readable source version for ongoing edits.
- Includes explicit Markdown heading hierarchy, making it the best base for future editorial work.
- Word count is slightly higher than the reader and narration exports, suggesting it preserves more markup-driven structure and some copy that may be normalized downstream.
- Includes figures by reference and aligns with the 2025 edition branding.

### 2. `editions/RCDM-v2-DRAFT2.pdf`
- Earlier and shorter than the later PDF by about 3,500 words and 6 pages.
- Preface language is clearly draft-oriented: it calls itself a rough draft and references a Google Classroom module under construction.
- Early extracted pages show the book beginning with Preface and Introduction material, with less polished framing than the newer manuscript family.
- Includes figures in laid-out PDF form.

### 3. `editions/RCDM-v2.pdf`
- Later PDF sent on 2026-04-08.
- Closer to the later manuscript family, with updated prefatory language about the remote coaching module being in continual improvement.
- Longer than Draft 2, and includes the Prologue in the extracted opening pages.
- Best PDF candidate for sharing or archival comparison against the living Markdown manuscript.

### 4. `reader/book-content.html`
- Reader-ready HTML export of the manuscript.
- Essentially the web-reader presentation layer for the book body, with inline figure references and HTML paragraph markup.
- Word count closely matches the later PDF and narration export, which suggests it was generated from a similar source snapshot.

### 5. `reader/book-content.js`
- JavaScript-packaged content payload used by the interactive reader.
- Content family appears to match the HTML export, but embedded for browser-side loading.
- Best treated as an application asset rather than an editorial source of truth.

### 6. `narration/RCDM-narration-script.txt`
- Clean text export intended for narration or TTS workflows.
- Closely tracks the same manuscript family as the reader exports, but with fewer layout dependencies.
- Best source for voice production and audiobook cleanup.

### 7. `curriculum/RCDM-Course-Outline.md`
- Not a book edition, but a curriculum companion.
- Maps the manuscript into a 12-unit course structure with estimated time, exercises, and evaluations.
- Useful for connecting the manuscript to teaching and training deliverables.

## Bottom line

The repository now contains three distinct manuscript states worth tracking:

1. **Draft 2 PDF**: the earlier rough-draft laid-out edition.
2. **Later manuscript family**: `RCDM-v2.1.md`, `RCDM-v2.pdf`, `book-content.html`, `book-content.js`, and `RCDM-narration-script.txt`.
3. **Curriculum companion**: `RCDM-Course-Outline.md`.

For future edits, `editions/RCDM-v2.1.md` should be treated as the primary editable source, with the reader, narration, and PDF outputs considered derivative or delivery-specific formats.
