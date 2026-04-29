#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const VOICE_ID = 'bwxOJkWapAsieGYpeBMX';
const VOICE_NAME = 'Coach Willie';
const MODEL_ID = 'eleven_multilingual_v2';
const SOURCE_VERSION = 'v2.1';
const MAX_CHARS = 9500;
const apiKey = process.env.ELEVENLABS_API_KEY;
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const sourcePath = join(repoRoot, 'editions', 'markdown', 'RCDM-v2.1.md');
const textOutDir = join(repoRoot, 'narration', 'strategy-v2.1');
const chunkOutDir = join(repoRoot, 'reader', 'audiobook', 'strategy-v2.1-chunks');
const audioOutDir = join(repoRoot, 'reader', 'audiobook');
const manifestOutPath = join(
  repoRoot,
  'reader',
  'audio-manifests',
  'coach-willie-2026-04-29-strategy-v2.1.json',
);

const tracks = [
  {
    number: '17',
    id: 'what-is-strategy',
    title: 'What is Strategy?',
    startHeading: '### What is Strategy?',
    endHeading: '### Making Your Bet: The Game Of Odds',
  },
  {
    number: '18',
    id: 'making-your-bet-the-game-of-odds',
    title: 'Making Your Bet: The Game Of Odds',
    startHeading: '### Making Your Bet: The Game Of Odds',
    endHeading: '#### Making Your Bet: Venue Research',
  },
  {
    number: '19',
    id: 'making-your-bet-venue-research',
    title: 'Making Your Bet: Venue Research',
    startHeading: '#### Making Your Bet: Venue Research',
    endHeading: '#### Making Your Bet: Incorporating Forecasts Into Decision Making',
  },
  {
    number: '20',
    id: 'making-your-bet-incorporating-forecasts',
    title: 'Making Your Bet: Incorporating Forecasts Into Decision Making',
    startHeading: '#### Making Your Bet: Incorporating Forecasts Into Decision Making',
    endHeading: '#### Making Your Bet: Master The Compass',
  },
  {
    number: '21',
    id: 'making-your-bet-master-the-compass',
    title: 'Making Your Bet: Master The Compass',
    startHeading: '#### Making Your Bet: Master The Compass',
    endHeading: '#### Making Your Bet: Course Geometry',
  },
  {
    number: '22',
    id: 'making-your-bet-course-geometry',
    title: 'Making Your Bet: Course Geometry',
    startHeading: '#### Making Your Bet: Course Geometry',
    endHeading: '#### Making Your Bet: Hedging Your Bets',
  },
  {
    number: '23',
    id: 'making-your-bet-hedging-your-bets',
    title: 'Making Your Bet: Hedging Your Bets',
    startHeading: '#### Making Your Bet: Hedging Your Bets',
    endHeading: '### 5 Types of Day',
  },
  {
    number: '24',
    id: '5-types-of-day-foundations',
    title: '5 Types of Day: Foundations Of The System',
    startHeading: '### 5 Types of Day',
    endHeading: '#### Type 1: Connect the Dots',
  },
  {
    number: '25',
    id: 'type-1-connect-the-dots',
    title: 'Type 1: Connect the Dots',
    startHeading: '#### Type 1: Connect the Dots',
    endHeading: '#### Type 2: Inside Track',
  },
  {
    number: '26',
    id: 'type-2-inside-track',
    title: 'Type 2: Inside Track',
    startHeading: '#### Type 2: Inside Track',
    endHeading: '#### Type 3: Outside Track',
  },
  {
    number: '27',
    id: 'type-3-outside-track',
    title: 'Type 3: Outside Track',
    startHeading: '#### Type 3: Outside Track',
    endHeading: '#### Type 4: Edge Out',
  },
  {
    number: '28',
    id: 'type-4-edge-out',
    title: 'Type 4: Edge Out',
    startHeading: '#### Type 4: Edge Out',
    endHeading: '#### Type 5: Uncertain',
  },
  {
    number: '29',
    id: 'type-5-uncertain',
    title: 'Type 5: Uncertain',
    startHeading: '#### Type 5: Uncertain',
    endHeading: '### Spirit Animals Of the Five Types Of Day',
  },
  {
    number: '30',
    id: 'spirit-animals-of-the-five-types-of-day',
    title: 'Spirit Animals Of the Five Types Of Day',
    startHeading: '### Spirit Animals Of the Five Types Of Day',
    endHeading: '## III. Tactics',
  },
];

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function extractSection(markdown, startHeading, endHeading) {
  const start = markdown.indexOf(startHeading);
  if (start === -1) throw new Error(`Missing start heading: ${startHeading}`);
  const end = markdown.indexOf(endHeading, start + startHeading.length);
  if (end === -1) throw new Error(`Missing end heading: ${endHeading}`);
  return markdown.slice(start, end).trim();
}

function cleanForNarration(markdown) {
  return markdown
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith('![')) return false;
      if (/^\\?\*{3}\s*$/.test(trimmed)) return false;
      if (/^\*?(Figure|Table)\s+\d/i.test(trimmed)) return false;
      return true;
    })
    .map((line) => {
      let cleaned = line;
      cleaned = cleaned.replace(/^#{3,6}\s+/g, '');
      cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
      cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
      cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
      cleaned = cleaned.replace(/\\\*/g, '');
      cleaned = cleaned.replace(/\u00a0/g, ' ');
      cleaned = cleaned.replace(/[ \t]+$/g, '');
      return cleaned;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoChunks(text) {
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CHARS) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (paragraph.length <= MAX_CHARS) {
      current = paragraph;
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*|.+$/g) || [paragraph];
    current = '';
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
      if (next.length <= MAX_CHARS) {
        current = next;
      } else {
        if (current) chunks.push(current);
        current = sentence.trim();
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function synthesize(text, outputPath) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs request failed ${response.status}: ${body}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, audio);
}

function concatMp3(chunks, outputPath) {
  const listPath = `${outputPath}.concat.txt`;
  const list = chunks.map((chunk) => `file '${chunk.replaceAll("'", "'\\''")}'`).join('\n');
  writeFileSync(listPath, `${list}\n`);
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath], {
    stdio: 'inherit',
  });
}

async function main() {
  if (!apiKey && !dryRun) {
    throw new Error('Set ELEVENLABS_API_KEY before running, or use --dry-run.');
  }

  ensureDir(textOutDir);
  ensureDir(chunkOutDir);
  ensureDir(audioOutDir);

  const markdown = readFileSync(sourcePath, 'utf8');
  const manifest = {
    version: 'coach-willie-2026-04-29-strategy-v2.1',
    voice: VOICE_NAME,
    voiceId: VOICE_ID,
    provider: 'ElevenLabs',
    model: MODEL_ID,
    defaultSourceTextVersion: SOURCE_VERSION,
    provenanceNote: 'Strategy section tracks generated from RCDM v2.1 with the Coach Willie ElevenLabs voice.',
    tracks: [],
  };

  for (const track of tracks) {
    const raw = extractSection(markdown, track.startHeading, track.endHeading);
    const cleaned = cleanForNarration(raw);
    const chunks = splitIntoChunks(cleaned);
    const fileName = `${track.number}-${track.id}.mp3`;
    const finalPath = join(audioOutDir, fileName);
    const trackTextDir = join(textOutDir, `${track.number}-${track.id}`);
    const trackChunkDir = join(chunkOutDir, `${track.number}-${track.id}`);
    ensureDir(trackTextDir);
    ensureDir(trackChunkDir);

    writeFileSync(join(trackTextDir, 'full.txt'), `${cleaned}\n`);
    chunks.forEach((chunk, index) => {
      writeFileSync(join(trackTextDir, `chunk-${String(index + 1).padStart(2, '0')}.txt`), `${chunk}\n`);
    });

    console.log(`${track.number} ${track.title}: ${cleaned.length} chars, ${chunks.length} chunks`);

    const chunkPaths = [];
    for (const [index, chunk] of chunks.entries()) {
      const chunkPath = join(trackChunkDir, `chunk-${String(index + 1).padStart(2, '0')}.mp3`);
      chunkPaths.push(chunkPath);
      if (dryRun) continue;
      if (existsSync(chunkPath) && !force) {
        console.log(`  skip existing ${chunkPath}`);
        continue;
      }
      console.log(`  synthesize chunk ${index + 1}/${chunks.length}`);
      await synthesize(chunk, chunkPath);
    }

    if (!dryRun) {
      if (chunks.length === 1) {
        if (!existsSync(finalPath) || force) {
          writeFileSync(finalPath, readFileSync(chunkPaths[0]));
        }
      } else if (!existsSync(finalPath) || force) {
        concatMp3(chunkPaths, finalPath);
      }
    }

    manifest.tracks.push({
      id: track.id,
      chapterId: track.id,
      title: track.title,
      src: `audiobook/${fileName}`,
      sourceTextVersion: SOURCE_VERSION,
      provenanceNote: `Generated from RCDM v2.1 with ElevenLabs ${VOICE_NAME} voice.`,
      chunks: chunks.length,
      characters: cleaned.length,
    });
  }

  writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifestOutPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
