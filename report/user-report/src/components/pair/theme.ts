"use strict";

import { theme } from "../../theme";

// ── THE PAIR THEME ────────────────────────────────────────────────────────
//
// One file decides every colour this view uses: the wash behind a line, the
// band that connects it to its twin, the editor tokens, and the chrome the
// components borrow from the report. No component in `pair/` knows a hex.
//
// CONTRAST RULE: every wash is DARK and SATURATED — a deep red, a deep teal —
// so the light editor tokens on top keep a readable contrast (light text on a
// dark tint, like white on dark blue). A pale translucent wash (light amber,
// light red at low alpha over light text) washed the glyphs out; nothing here
// is lighter than the code surface it sits on.

const SAME = "255, 107, 107";
const DIFF = "120, 200, 170";
// The row band: visible, but far below the glyphs' own luminance.
const A = 0.16;
const A_DIFF = 0.12;
// THE ONE LANE under the pointer: the same hue, held stronger.
const A_HOT = 0.3;
// The MARK over the exact occurrence: a saturated wash of the lane's own hue —
// dark enough that the light token ink stays readable on it, strong enough to
// read as "this exact word" over the row band. Never a pale highlighter.
const A_MARK = 0.42;

const rgba = (rgb, alpha) => `rgba(${rgb}, ${alpha})`;

// Editor tokens: what Prism emits, coloured like a dark editor theme.
const TOKEN = {
	comment: "#8b98a9",
	keyword: "#c792ea",
	string: "#c3e88d",
	number: "#f78c6c",
	function: "#82aaff",
	className: "#ffcb6b",
	operator: "#89ddff",
	decorator: "#f07178",
};

export const pairTheme = {
	alpha: A,
	// A line that exists on both sides. The band is the same colour as the wash:
	// the wash is the row, the band is the road between the two rows.
	band: { same: `rgb(${SAME})`, diff: `rgb(${DIFF})` },
	wash: { same: rgba(SAME, A), diff: rgba(DIFF, A_DIFF), hot: rgba(SAME, A_HOT), hotDiff: rgba(DIFF, 0.24) },
	// The exact occurrence a lane is about: a saturated wash of the lane's hue,
	// painted BEHIND the glyphs. Light ink on a dark saturated tint reads; a
	// pale amber highlighter under light ink did not.
	mark: { same: rgba(SAME, A_MARK), diff: rgba(DIFF, 0.34) },
	// The ribbon itself: a visible ROAD through the corridor, stronger than the
	// row wash. ONE calm shade from end to end; `hot` is the same hue held a
	// little stronger for the lane under the pointer, painted ONCE.
	ribbon: { same: rgba(SAME, 0.3), diff: rgba(DIFF, 0.24), hot: rgba(SAME, 0.44), hotDiff: rgba(DIFF, 0.36) },
	token: TOKEN,
	chrome: {
		panel: theme.color.panel,
		panelAlt: theme.color.panelAlt,
		border: theme.color.border,
		borderStrong: theme.color.borderStrong,
		text: theme.color.text,
		dim: theme.color.textDim,
		faint: theme.color.textFaint,
		// The line-number plate: a shade lighter than the code surface, so the
		// numbers read as a separate strip the code slides under.
		numberPlate: "#35435f",
		accent: theme.color.accent,
	},
	font: theme.font,
	radius: theme.radius,
};

// The token palette, as a styled-components interpolation. Prism emits spans of
// class `token token-*`; they are coloured by nesting, so the palette stays in
// this file and no component carries a CSS string.
export const tokenStyles = (selector = ".token") => `
	${selector}.comment, ${selector}.prolog, ${selector}.doctype, ${selector}.cdata { color: ${TOKEN.comment}; font-style: italic; }
	${selector}.keyword, ${selector}.boolean, ${selector}.important { color: ${TOKEN.keyword}; }
	${selector}.string, ${selector}.template-string, ${selector}.regex, ${selector}.char, ${selector}.attr-value { color: ${TOKEN.string}; }
	${selector}.number { color: ${TOKEN.number}; }
	${selector}.function, ${selector}.method, ${selector}.property-access { color: ${TOKEN.function}; }
	${selector}.class-name, ${selector}.builtin, ${selector}.constant, ${selector}.symbol { color: ${TOKEN.className}; }
	${selector}.operator, ${selector}.punctuation { color: ${TOKEN.operator}; }
	${selector}.decorator, ${selector}.annotation, ${selector}.attr-name { color: ${TOKEN.decorator}; }
`;