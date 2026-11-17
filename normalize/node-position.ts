"use strict";

// WHERE a ts-morph node is written. ts-morph exposes line numbers but not
// columns, so `columnAt` is the one place that turns a character offset into a
// 1-based column, and `siteOf` pairs it with the line. Shared by the parser
// (playgrounds/typescript.ts) and the node helpers (entities/tree/node.ts) so a
// position is never computed two slightly different ways.

// 1-based column of a character position.
const columnAt = (sourceFile, pos) => {
	const text = sourceFile.getFullText();
	let index = pos - 1;
	while (index >= 0 && text[index] !== "\n") index -= 1;

	return pos - index;
};

// WHERE a node is written: line and 1-based column.
const siteOf = (node) => {
	if (!node || typeof node.getStartLineNumber !== "function") return { line: null, column: null };

	return { line: node.getStartLineNumber(), column: columnAt(node.getSourceFile(), node.getStart()) };
};

export { columnAt, siteOf };