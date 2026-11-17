import { createGlobalStyle } from "styled-components";

// One palette for the whole page — the same language follow-architecture uses,
// so the two reports read as one tool:
//
//   * panels are lifted off the background (bg < panel < panelAlt), so a block of
//     code is a surface, not a hole;
//   * text is #e2e8f2 on #0b0e14 and the dim tone is #a9b5c5 — the old #6b7788
//     on #0b0e14 was unreadable at the 11-12px the tables use;
//   * RED means "this part is the DUPLICATE" — the thing the tool is reporting.
//     GREEN means "this part is UNIQUE to its side" — the only place the two
//     actually differ. AMBER is a neutral label. Nothing else borrows those three.
//
// That is the opposite of an editor diff, and on purpose: this is not "what did
// I change", it is "how much of this file is a copy". A pair at 1.00 is all red,
// because all of it is the same code twice.

export const theme = {
	color: {
		bg: "#0b0e14",
		panel: "#121722",
		panelAlt: "#171f2e",
		border: "#243044",
		borderStrong: "#3a4a64",
		text: "#e2e8f2",
		textDim: "#a9b5c5",
		textFaint: "#7c8899",
		accent: "#6ea8fe",
		danger: "#ff6b6b",
		ok: "#4ade80",
		warn: "#fbbf24",
		removed: "#ff6b6b",
		added: "#4ade80",
		changed: "#fbbf24",
		violet: "#b48ef0",
		part: "#f78c6c",
		teal: "#56c8a8",
		structure: "#f0a35e",
	},
	// The code surface and the diff washes. Kept apart from `color` because they
	// are about the code block, not about the chrome.
	code: {
		bg: "#080b11",
		// A word that is the SAME on both sides (the duplicate) and a word that
		// exists on one side only (the unique part).
		dup: "rgba(255, 107, 107, 0.26)",
		dupSoft: "rgba(255, 107, 107, 0.12)",
		uniq: "rgba(61, 220, 132, 0.26)",
		uniqSoft: "rgba(61, 220, 132, 0.12)",
		slot: "rgba(251, 191, 36, 0.22)",
	},
	font: {
		mono: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
		sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
	},
	radius: { sm: "6px", md: "10px", lg: "14px" },
	space: (n) => `${n * 4}px`,
};

// Row tints, keyed by the shared ROW type. An EQUAL row is RED-tinted: it is the
// duplicated mass, the reason the pair was reported. A CHANGE row is green — the
// unique part. A one-sided row is green too: that line exists on one side only.
// ONLY the duplicated lines are tinted, and only RED. A line that exists on one
// side is not a finding, so it stays plain — no green anywhere in the code.
export const ROW_TINT = {
	equal: "rgba(255, 107, 107, 0.16)",
	add: "transparent",
	remove: "transparent",
	change: "transparent",
};

// The two states of a per-row mark in the gutter. SAME is red (a duplicate: this
// group agrees, so this line is more of the same code), DIFFERS is green (this
// group can tell the two lines apart, so the line carries something unique).
export const MARK_COLOR = {
	same: "#ff6b6b", // this group agrees here -> more duplicated code
	diff: "#5a6678", // this group can tell the lines apart -> neutral, not a finding
};

// The two meanings spelled out for the parts that build their own backgrounds.
export const DUPLICATE = MARK_COLOR.same;
export const UNIQUE = MARK_COLOR.diff;

// The diff grid columns, in one place because the header and the rows must line
// up: marks | line no | left code | OVERLAP | line no | right code.
export const GUTTER = "52px";
export const OVERLAY_MIN = "190px";

export const GlobalStyle = createGlobalStyle`
	*, *::before, *::after { box-sizing: border-box; }
	html, body, #root { height: 100%; }
	body {
		margin: 0;
		background: ${(p) => p.theme.color.bg};
		color: ${(p) => p.theme.color.text};
		font-family: ${(p) => p.theme.font.sans};
		font-size: 14px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	a { color: ${(p) => p.theme.color.accent}; text-decoration: none; }
	a:hover { text-decoration: underline; }
	code, pre { font-family: ${(p) => p.theme.font.mono}; }
	::selection { background: rgba(110, 168, 254, 0.32); }
	::-webkit-scrollbar { width: 10px; height: 10px; }
	::-webkit-scrollbar-thumb { background: ${(p) => p.theme.color.borderStrong}; border-radius: 8px; }
	::-webkit-scrollbar-track { background: transparent; }
	button { font-family: inherit; }
`;
