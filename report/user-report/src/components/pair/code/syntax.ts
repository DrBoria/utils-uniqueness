"use strict";

// ── SYNTAX HIGHLIGHTING ────────────────────────────────────────────────────
//
// The code is highlighted per LANGUAGE, exactly like an editor does it:
// Prism tokenizes the whole function (so multi-line strings and comments come
// out right) and the result is split back into lines, one per row of the diff.
// Languages are chosen by file extension: .ts/.tsx/.js/.jsx/.json.
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";

const LANGS = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".mjs": "javascript",
	".cjs": "javascript",
	".json": "json",
};

export const langOf = (path) => {
	const match = String(path ?? "").match(/\.[a-z]+$/i);

	return LANGS[match ? match[0].toLowerCase() : ""] ?? "typescript";
};

export const highlightLines = (text, lang) => {
	const grammar = Prism.languages[lang] ?? Prism.languages.typescript;

	return Prism.highlight(text, grammar, lang).split("\n");
};

// The same tokenizer, but as DATA: one flat list of `{ text, type }` pieces.
// The renderer colours a piece by its type; nothing in the view re-parses HTML.
const flatten = (stream, type, out) => {
	for (const piece of stream) {
		if (typeof piece === "string") out.push({ text: piece, type });
		else if (typeof piece.content === "string") out.push({ text: piece.content, type: piece.type });
		else flatten(piece.content, piece.type, out);
	}

	return out;
};

export const tokensOf = (text, lang) => {
	const grammar = Prism.languages[lang] ?? Prism.languages.typescript;

	return flatten(Prism.tokenize(String(text ?? ""), grammar), null, []);
};

export default highlightLines;
