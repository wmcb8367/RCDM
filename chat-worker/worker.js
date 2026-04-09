// Cloudflare Worker — Gemini chat proxy for RCDM book reader
// Deploy: npx wrangler deploy
// Set secret: npx wrangler secret put GEMINI_API_KEY

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPT = `You are an expert sailing coach helping readers understand Willie McBride's book "Race Course Decision Making" (2025 Edition).

Rules:
- Answer ONLY from the book context provided. Do not make up information.
- If the answer isn't in the provided context, say "I don't see that covered in this section of the book. Try asking about a different topic from this chapter."
- Keep answers concise and practical — 2-4 paragraphs max.
- Reference specific concepts from the book when possible.
- Write in a friendly, coaching tone.`;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    try {
      const { question, chapterTitle, chapterText, relatedChapters } = await request.json();

      if (!question || !chapterTitle) {
        return new Response(JSON.stringify({ error: 'Missing question or chapterTitle' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // Build context from chapter text + related chapters
      let context = `Current chapter: ${chapterTitle}\n\n${(chapterText || '').slice(0, 6000)}`;
      if (relatedChapters && relatedChapters.length > 0) {
        context += '\n\nRelated chapters:\n';
        relatedChapters.forEach(ch => {
          context += `\n--- ${ch.title} ---\n${(ch.text || '').slice(0, 2000)}\n`;
        });
      }

      const geminiBody = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `Book context:\n${context}\n\nReader's question: ${question}` }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      };

      const geminiResponse = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      if (!geminiResponse.ok) {
        const err = await geminiResponse.text();
        console.error('Gemini error:', err);
        return new Response(JSON.stringify({ error: 'AI service error', detail: geminiResponse.status }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const data = await geminiResponse.json();
      const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';

      return new Response(JSON.stringify({ answer }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
