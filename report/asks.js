"use strict";

// A finding states WHAT is wrong; a repair states WHAT TO DO. The two are kept
// apart because the same verdict can be repaired in more than one way (point at
// the canonical, or point at an installed dependency that already does it), and
// because the HTML page links a repair to the exact place it applies to.
//
// Every repair is `{ action, text, target }`:
//   action — a stable id (`use-canonical`, `from-lib`, `move-to-utils`,
//            `inline`, `none`) so the UI can label it without parsing the
//            sentence;
//   text   — the sentence, from the vocabulary;
//   target — the place the repair points at (path + range), when it has one.

const { PHRASES, fill } = require("./errorTypes/vocabulary/phrases");
const { ACTION } = require("../constants");

const useCanonical = (canon) => ({
	action: ACTION.UseCanonical,
	text: fill(PHRASES.fixUseCanonical, { name: canon.name, path: canon.path }),
	target: canon.path ? { path: canon.path, line: canon.line ?? 1 } : null,
});

const fromLib = (suggestion) => ({
	action: ACTION.FromLib,
	text: fill(PHRASES.fixFromLib, { name: suggestion.name, lib: suggestion.lib }),
	target: null,
});

const moveToUtils = (name, folders) => ({
	action: ACTION.MoveToUtils,
	text: fill(PHRASES.fixMoveToUtils, {
		name,
		folder: (folders ?? []).map((f) => `\`${f}\``).join(" or ") || "the utils folder",
	}),
	target: (folders ?? [])[0] ? { path: folders[0], line: null } : null,
});

const inline = (name, body) => ({
	action: ACTION.Inline,
	text: fill(PHRASES.fixInline, { name, body: String(body ?? "").replace(/\s+/g, " ").trim() }),
	target: null,
});

const none = () => ({ action: ACTION.None, text: PHRASES.fixKeep, target: null });

module.exports = { useCanonical, fromLib, moveToUtils, inline, none };
