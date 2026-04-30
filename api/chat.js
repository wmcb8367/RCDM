const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_QUESTION_CHARS = 900;
const MAX_CHAPTER_CHARS = 6000;
const MAX_RELATED_CHAPTERS = 3;
const MAX_RELATED_CHARS = 1800;
const MAX_OUTPUT_TOKENS = Number(process.env.CHAT_MAX_OUTPUT_TOKENS || 700);
const DAILY_REQUEST_LIMIT = Number(process.env.CHAT_DAILY_REQUEST_LIMIT || 75);

const usageByIp = globalThis.__rcdmChatUsageByIp || new Map();
globalThis.__rcdmChatUsageByIp = usageByIp;

const SYSTEM_PROMPT = [
  'You are Coach Willie, a concise expert sailing coach for the Race Course Decision Making interactive reader.',
  'Your primary source of truth is the provided book context.',
  'You may add generally accepted technical sailboat racing knowledge only when it directly helps explain the book context.',
  'Do not answer unrelated questions, general trivia, coding, legal, medical, financial, or harmful requests.',
  'If a request is outside the book and technical sailboat racing, say you can only help with Race Course Decision Making and sailboat racing topics.',
  'If the provided context is not enough, say what is missing and suggest the closest relevant chapter topic.',
  'If a reader asks how to access the McBride Racing Google Classroom curriculum, explain that curriculum access and launch updates are handled through the McBride Racing newsletter and direct them to sign up on the McBride Racing website newsletter section.',
  'Keep answers practical, specific, and no more than three short paragraphs.',
  'Mention the chapter or concept you are drawing from when it helps the reader orient.'
].join('\n');

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(req) {
  const key = `${dayKey()}:${clientIp(req)}`;
  const current = usageByIp.get(key) || 0;
  if (current >= DAILY_REQUEST_LIMIT) {
    return false;
  }
  usageByIp.set(key, current + 1);
  return true;
}

function cleanText(value, maxChars) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function buildContext(body) {
  const chapterTitle = cleanText(body.chapterTitle, 180) || 'Current chapter';
  const chapterText = cleanText(body.chapterText, MAX_CHAPTER_CHARS);
  const related = Array.isArray(body.relatedChapters)
    ? body.relatedChapters.slice(0, MAX_RELATED_CHAPTERS)
    : [];

  const sections = [
    `Current chapter: ${chapterTitle}`,
    chapterText
  ];

  if (related.length) {
    sections.push('Related book context:');
    related.forEach((chapter) => {
      const title = cleanText(chapter?.title, 180) || 'Related chapter';
      const text = cleanText(chapter?.text, MAX_RELATED_CHARS);
      if (text) {
        sections.push(`--- ${title} ---\n${text}`);
      }
    });
  }

  return sections.filter(Boolean).join('\n\n');
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, 503, { error: 'Assistant is not configured yet.' });
  }

  if (!checkRateLimit(req)) {
    return sendJson(res, 429, { error: 'Daily assistant limit reached.' });
  }

  const body = req.body || {};
  const question = cleanText(body.question, MAX_QUESTION_CHARS);
  if (!question) {
    return sendJson(res, 400, { error: 'Missing question.' });
  }

  const context = buildContext(body);
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              'Book context:',
              context,
              '',
              'Reader question:',
              question
            ].join('\n')
          }
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return sendJson(res, 502, {
        error: 'Assistant service error.',
        status: upstream.status
      });
    }

    const answer = Array.isArray(data.content)
      ? data.content.map((part) => part.text || '').join('').trim()
      : '';

    return sendJson(res, 200, {
      answer: answer || 'I could not generate a useful answer from the available book context.',
      usage: data.usage || null,
      model
    });
  } catch (error) {
    return sendJson(res, 500, { error: 'Assistant request failed.' });
  }
};
