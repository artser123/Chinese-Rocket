# Project Notes

- This is a static HTML/CSS/JavaScript game; serve the repository root with `python -m http.server 8000`.
- Regenerate `data/sentences.js` from `HSK Database/HSK_Grammar_Database_HSK1_to_5.xlsx` with `python tools/extract_sentences.py` from the repository root.
- Validate JavaScript with `node --check game.js` and `node --check data/sentences.js`.
- Sentence data uses `[Chinese, Pinyin, Thai, Grammar Focus, Tokens]`, grouped by HSK level in the global `SENTENCES` object.
- Vocabulary data uses `[Chinese, Pinyin, Thai]` in the global `VOCAB` object; validate it with `node --check data/vocab.js`.
- The writing mode loads Hanzi Writer 3.7.3 (with SRI) and hanzi-writer-data 2.0.1 from jsDelivr. Internet access is required for uncached characters; load failures must not consume lives or writing time.
- Reuse the Hanzi Writer instance across characters and sessions because it registers document-level input listeners. Use `updateDimensions` when its container resizes so stroke coordinates remain accurate on mobile.
- Hanzi Writer's `drawingWidth` is in its 1024-unit character coordinate system, not CSS pixels; it scales with the writing canvas.
