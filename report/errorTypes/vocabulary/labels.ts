"use strict";

import { SIGNAL, KIND, TIER } from "../../../constants";

// The words the report uses for the four comparison groups. A signal is named
// once here and read back by the terminal report, the HTML page and the log, so
// "structure 1.00" in a message and the orange bar in the picture are the same
// thing. The colour is the ONE colour of that signal everywhere: legend, bar,
// highlighted row, evidence chip.

const SIGNALS = [
	{
		key: SIGNAL.Signature,
		label: "Signature",
		short: "sig",
		color: "#6ea8fe",
		what: "name, parameters and return type",
	},
	{
		key: SIGNAL.Structure,
		label: "Structure",
		short: "struct",
		color: "#f0a35e",
		what: "the set of constructs the body is built from",
	},
	{
		key: SIGNAL.Ast,
		label: "AST",
		short: "ast",
		color: "#b48ef0",
		what: "the exact expression tree of the body",
	},
	{
		key: SIGNAL.ControlFlow,
		label: "Control flow",
		short: "flow",
		color: "#56c8a8",
		what: "the order of branches, loops and returns",
	},
];

const SIGNAL_KEYS = SIGNALS.map((s) => s.key);

const signalOf = (key) => SIGNALS.find((s) => s.key === key) ?? SIGNALS[0];

const signalColor = (key) => signalOf(key).color;

// What each KIND of finding is, what colour it has, and what the reader is
// asked to do about it. `action` is the verb of the repair, not the sentence.
const KINDS = {
	[KIND.Duplicate]: { label: "Duplicate", color: "#ff6b6b", action: "use the canonical" },
	[KIND.Similar]: { label: "Similar", color: "#fbbf24", action: "consider the canonical" },
	[KIND.Part]: { label: "Partial duplicate", color: "#f78c6c", action: "reuse the canonical" },
	[KIND.Missing]: { label: "Missing util", color: "#7fdbca", action: "extract one shared util" },
	[KIND.Cluster]: { label: "Cross-file copy", color: "#ffd166", action: "extract to utils" },
	[KIND.Trash]: { label: "Trash", color: "#95a1b3", action: "inline at the call site" },
	[KIND.Dropped]: { label: "Filtered out", color: "#6b7788", action: "none — a filter explained it away" },
	unreadable: { label: "Not read", color: "#6b7788", action: "nothing — the file was skipped" },
};

const kindOf = (key) => KINDS[key] ?? KINDS[KIND.Similar];

// The same kinds as a COUNTABLE list (a tile says "Duplicates: 130"). Plural on
// purpose; the colour still comes from KINDS above.
const KIND_TILES = Object.freeze([
	{ key: KIND.Duplicate, label: "Duplicates" },
	{ key: KIND.Similar, label: "Similar" },
	{ key: KIND.Part, label: "Partial duplicates" },
	{ key: KIND.Missing, label: "Missing utils" },
	{ key: KIND.Cluster, label: "Cross-file copies" },
	{ key: KIND.Trash, label: "Trash one-liners" },
	{ key: KIND.Dropped, label: "Filtered out" },
]);

const TIER_LABEL = {
	[TIER.Duplicate]: "Duplicate (confidence ≥ threshold)",
	[TIER.Similar]: "Similar (below duplicate threshold)",
	none: "Below every threshold",
};

export {  SIGNALS, SIGNAL_KEYS, signalOf, signalColor, KINDS, kindOf, KIND_TILES, TIER_LABEL  };
