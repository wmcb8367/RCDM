# AI Coach Suggested Questions

The reader stores curated AI Coach copy in versioned metadata files:

- `reader/content/v2.2/ai-coach.json`

Use chapter `id` values from the matching `book-manifest.json`, not chapter titles. Titles may change for display, but ids are stable enough to use as metadata keys.

## Shape

```json
{
  "version": "v2.2",
  "chapters": {
    "preface": {
      "endPrompt": "Text shown at the top of the Coach Willie panel when the reader is at the end of the chapter.",
      "bubbleText": "Short text for the collapsed assistant bubble.",
      "suggestedQuestions": [
        "Optional curated question.",
        "Optional curated question.",
        "Optional curated question."
      ]
    }
  }
}
```

## Fallbacks

If a chapter has no curated entry, the reader keeps using its generated copy and generated suggested questions. That lets us update chapters one at a time without leaving the assistant empty.
