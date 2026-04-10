# Audiobook Files — Naming Convention

## Format
`{nn}-{slug}.mp3` where:
- `{nn}` = zero-padded chapter order (matches book-manifest.json order)
- `{slug}` = lowercase kebab-case of chapter title

## Current Files (1:1 chapter audio)
| # | File | Chapter |
|---|------|---------|
| 01 | `01-preface.mp3` | Preface |
| 02 | `02-prologue-full.mp3` | Prologue: The Education of a Coach |
| 06 | `06-introduction-to-rcdm.mp3` | Introduction To Race Course Decision Making |
| 07 | `07-three-building-blocks.mp3` | The Three Building Blocks Of Race Course Decision Making |
| 08 | `08-building-a-process.mp3` | Building A Process For Learning Race Course Decision Making |

## Pending (need individual recordings)
| # | Expected File | Chapter |
|---|--------------|---------|
| 03 | `03-introduction.mp3` | Introduction |
| 04 | `04-overview-of-race-course-philosophy.mp3` | Overview of Race Course Philosophy Tactics and Strategy |
| 09 | `09-what-is-race-course-philosophy.mp3` | What Is Race Course Philosophy? |
| 10 | `10-what-we-know-about-the-starting-line.mp3` | What We Know About The Starting Line |
| 11 | `11-first-beat-fundamentals.mp3` | First Beat Fundamentals |
| 12 | `12-weather-mark-layline-management.mp3` | Weather Mark Layline Management |
| 13 | `13-9-ways-to-pass-boats-downwind.mp3` | 9 Ways To Pass Boats Downwind |
| 14 | `14-the-downwind-decision-diamond.mp3` | The Downwind Decision Diamond |
| 15 | `15-downwind-philosophy-of-symmetrical-spinnaker-boats.mp3` | Downwind Philosophy Of Symmetrical Spinnaker Boats |
| 16 | `16-the-evolution-of-race-course-philosophy.mp3` | The Evolution of Race Course Philosophy |
| 17 | `17-what-is-strategy.mp3` | What is Strategy? |
| 18 | `18-making-your-bet-the-game-of-odds.mp3` | Making Your Bet: The Game Of Odds |
| 19 | `19-5-types-of-day.mp3` | 5 Types of Day |
| 20 | `20-spirit-animals-of-the-five-types-of-day.mp3` | Spirit Animals Of the Five Types Of Day |
| 21 | `21-what-are-tactics.mp3` | What Are Tactics? |
| 22 | `22-tactics-of-connect-the-dots.mp3` | Tactics of Connect The Dots |
| 23 | `23-tactics-of-the-inside-track.mp3` | Tactics of The Inside Track |
| 24 | `24-uw-6.mp3` | UW 6 |
| 25 | `25-uw-7.mp3` | UW 7 |
| 26 | `26-tactics-of-the-edge-out-strategy.mp3` | Tactics of The Edge Out Strategy |
| 27 | `27-tactics-of-the-outside-track.mp3` | Tactics of the Outside Track |
| 28 | `28-tactical-summary.mp3` | Tactical Summary |
| 29 | `29-conclusion.mp3` | Conclusion: Balancing Race Course Philosophy, Strategy and Tactics |
| 30 | `30-when-the-unconscious-becomes-conscious.mp3` | When The Unconscious Becomes Conscious |

## Adding a new audio file
1. Record the chapter as a single mp3
2. Name it using the convention above
3. Drop it in this `audiobook/` directory
4. Edit `book-manifest.json` — find the chapter entry and set:
   ```json
   "audio": { "src": "audiobook/{filename}.mp3", "id": "{slug}" }
   ```
5. Commit and push — the reader picks it up automatically

## Legacy files (multi-chapter, to be replaced)
- `03-introduction-full.mp3` — Spans Introduction + sub-chapters
- `04-tactics-full.mp3` — Spans III. Tactics + all sub-chapters
- `05-conclusion-full.mp3` — Spans Conclusion + sub-chapter
- `02-prologue-part-*.mp3` — Parts of prologue (full version exists)
- `03-introduction-part-*.mp3` — Parts of introduction
- `04-tactics-part-*.mp3` — Parts of tactics
