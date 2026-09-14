# Project Notes

- This is a static HTML/CSS/JavaScript game; serve the repository root with `python -m http.server 8000`.
- Regenerate `data/sentences.js` from `HSK Database/HSK_Grammar_Database_HSK1_to_5.xlsx` with `python tools/extract_sentences.py` from the repository root.
- Validate JavaScript with `node --check game.js` and `node --check data/sentences.js`.
- Sentence data uses `[Chinese, Pinyin, Thai, Grammar Focus, Tokens]`, grouped by HSK level in the global `SENTENCES` object.
