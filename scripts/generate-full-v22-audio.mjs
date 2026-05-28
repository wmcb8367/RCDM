#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const VOICE_ID = 'bwxOJkWapAsieGYpeBMX';
const VOICE_NAME = 'Coach Willie';
const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const SOURCE_VERSION = 'v2.2';
const MAX_CHARS = 9500;
const apiKey = process.env.ELEVENLABS_API_KEY;
const force = process.argv.includes('--force');
const archiveOnly = process.argv.includes('--archive-only');
const skipArchive = process.argv.includes('--skip-archive');

const sourcePath = join(repoRoot, 'editions', 'markdown', 'RCDM-v2.2.md');
const readerManifestPath = join(repoRoot, 'reader', 'book-manifest.json');
const rootAudioDir = join(repoRoot, 'audiobook');
const readerAudioDir = join(repoRoot, 'reader', 'audiobook');
const textOutDir = join(repoRoot, 'narration', 'full-v2.2');
const chunkOutDir = join(repoRoot, 'tmp', 'full-v2.2-chunks');
const archiveRoot = join(repoRoot, 'archive', 'audio-rebuild-2026-05-27-pre-unified');
const manifestOutPath = join(
  repoRoot,
  'reader',
  'audio-manifests',
  'coach-willie-2026-05-27-full-v2.2.json',
);

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function listDir(path) {
  try {
    return execFileSync('bash', ['-lc', "cd '" + path.replaceAll("'", "'\\''") + "' && find . -mindepth 1 -maxdepth 1 -print | sort"], { encoding: 'utf8' })
      .split('\n')
      .map(function(value) { return value.trim(); })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function moveDirContents(sourceDir, targetDir, keepNames) {
  ensureDir(targetDir);
  for (const entry of listDir(sourceDir)) {
    const name = entry.replace(/^\.\//, '');
    if (keepNames.has(name)) continue;
    const from = join(sourceDir, name);
    const to = join(targetDir, name);
    rmSync(to, { recursive: true, force: true });
    execFileSync('mv', [from, to]);
  }
}

function archiveCurrentAssets() {
  ensureDir(archiveRoot);
  moveDirContents(rootAudioDir, join(archiveRoot, 'audiobook-root'), new Set(['README.md']));
  moveDirContents(readerAudioDir, join(archiveRoot, 'reader-audiobook'), new Set(['README.md']));
  moveDirContents(join(repoRoot, 'reader', 'audio-manifests'), join(archiveRoot, 'reader-audio-manifests'), new Set(['template-version-locked.json']));
}

function slugifyHeading(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseHeadings(markdown) {
  const headings = [];
  const lines = markdown.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const match = line.match(/^(#{2,6})\s+(.*)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        id: slugifyHeading(match[2].trim()),
        offset: offset,
      });
    }
    offset += line.length + 1;
  }
  return headings;
}

function extractSection(markdown, headings, track) {
  const heading = headings.find(function(entry) {
    return entry.id === track.chapterId || entry.id === track.headingId;
  });
  if (!heading) throw new Error('Missing heading for chapter id: ' + track.chapterId);
  const next = headings.find(function(entry) { return entry.offset > heading.offset; });
  const end = next ? next.offset : markdown.length;
  return markdown.slice(heading.offset, end).trim();
}

function cleanForNarration(markdown) {
  return markdown
    .split('\n')
    .filter(function(line) {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith('![')) return false;
      if (/^\\?\*{3}\s*$/.test(trimmed)) return false;
      if (/^\*?(Figure|Table)\s+\d/i.test(trimmed)) return false;
      return true;
    })
    .map(function(line) {
      let cleaned = line;
      cleaned = cleaned.replace(/^#{2,6}\s+/g, '');
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
    const candidate = current ? current + '\n\n' + paragraph : paragraph;
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
      const next = current ? current + ' ' + sentence.trim() : sentence.trim();
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
    'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE_ID + '?output_format=' + OUTPUT_FORMAT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: text,
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
    throw new Error('ElevenLabs request failed ' + response.status + ': ' + body);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, audio);
}

async function synthesizeWithRetry(text, outputPath, attempts) {
  const maxAttempts = attempts || 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await synthesize(text, outputPath);
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delayMs = 3000 * attempt;
      console.error('Retry ' + attempt + '/' + (maxAttempts - 1) + ' for ' + basename(outputPath) + ' after error: ' + error.message);
      await new Promise(function(resolve) { setTimeout(resolve, delayMs); });
    }
  }
}

function concatMp3(chunks, outputPath) {
  const listPath = outputPath + '.concat.txt';
  const list = chunks.map(function(chunk) { return "file '" + chunk.replaceAll("'", "'\\''") + "'"; }).join('\n');
  writeFileSync(listPath, list + '\n');
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-ar', '44100', '-ac', '1', '-b:a', '128k', '-c:a', 'libmp3lame', outputPath], {
    stdio: 'inherit',
  });
}

function trackListFromManifest() {
  const manifest = JSON.parse(readFileSync(readerManifestPath, 'utf8'));
  return manifest.chapters
    .filter(function(chapter) { return chapter.audio && chapter.audio.src; })
    .map(function(chapter) {
      return {
        chapterId: chapter.id,
        title: chapter.title,
        level: chapter.level,
        headingId: slugifyHeading(chapter.title),
        audioId: chapter.audio.id || chapter.id,
        src: chapter.audio.src,
        fileName: basename(chapter.audio.src),
      };
    });
}

async function main() {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY must be set.');

  if (!skipArchive) {
    archiveCurrentAssets();
  }
  if (archiveOnly) {
    console.log('Archived current audio and manifests.');
    return;
  }

  ensureDir(textOutDir);
  ensureDir(chunkOutDir);
  ensureDir(rootAudioDir);
  ensureDir(readerAudioDir);

  const markdown = readFileSync(sourcePath, 'utf8');
  const headings = parseHeadings(markdown);
  const tracks = trackListFromManifest();
  const generatedManifest = {
    version: 'coach-willie-2026-05-27-full-v2.2',
    voice: VOICE_NAME,
    voiceId: VOICE_ID,
    provider: 'ElevenLabs',
    model: MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
    defaultSourceTextVersion: SOURCE_VERSION,
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0,
      use_speaker_boost: true,
    },
    provenanceNote: 'Full reader audiobook regenerated from RCDM v2.2 with a single standardized ElevenLabs pipeline for consistent voice and audio texture.',
    tracks: [],
  };

  for (const track of tracks) {
    const raw = extractSection(markdown, headings, track);
    const cleaned = cleanForNarration(raw);
    const chunks = splitIntoChunks(cleaned);
    const stem = track.fileName.replace(/\.mp3$/i, '');
    const trackTextDir = join(textOutDir, stem);
    const trackChunkDir = join(chunkOutDir, stem);
    const readerFinalPath = join(readerAudioDir, track.fileName);
    const rootFinalPath = join(rootAudioDir, track.fileName);
    ensureDir(trackTextDir);
    ensureDir(trackChunkDir);

    writeFileSync(join(trackTextDir, 'full.txt'), cleaned + '\n');
    chunks.forEach(function(chunk, index) {
      writeFileSync(join(trackTextDir, 'chunk-' + String(index + 1).padStart(2, '0') + '.txt'), chunk + '\n');
    });

    console.log(track.fileName + ': ' + cleaned.length + ' chars, ' + chunks.length + ' chunks');
    const chunkPaths = [];
    for (const [index, chunk] of chunks.entries()) {
      const chunkPath = join(trackChunkDir, 'chunk-' + String(index + 1).padStart(2, '0') + '.mp3');
      chunkPaths.push(chunkPath);
      if (!existsSync(chunkPath) || force) {
        console.log('  synthesize ' + track.fileName + ' chunk ' + (index + 1) + '/' + chunks.length);
        await synthesizeWithRetry(chunk, chunkPath, 4);
      } else {
        console.log('  reuse ' + basename(chunkPath));
      }
    }

    if (chunks.length === 1) {
      copyFileSync(chunkPaths[0], readerFinalPath);
    } else {
      concatMp3(chunkPaths, readerFinalPath);
    }
    copyFileSync(readerFinalPath, rootFinalPath);

    generatedManifest.tracks.push({
      id: track.audioId,
      chapterId: track.chapterId,
      title: track.title,
      src: track.src,
      sourceTextVersion: SOURCE_VERSION,
      provenanceNote: 'Generated from RCDM v2.2 with the standardized Coach Willie ElevenLabs pipeline on 2026-05-27.',
      chunks: chunks.length,
      characters: cleaned.length,
    });
  }

  writeFileSync(manifestOutPath, JSON.stringify(generatedManifest, null, 2) + '\n');
  console.log('Wrote ' + manifestOutPath);
}

main().catch(function(error) {
  console.error(error.stack || error.message);
  process.exit(1);
});
