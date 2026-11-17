"use strict";

// ── CONTROL-FLOW MATCHER · the words ────────────────────────────────────────

const PHRASES = Object.freeze({
	// `0.42  call ×2, return, try` — the score, then the blocks themselves. A run
	// that corresponds block for block has no share to print.
	run: "{score}  {chain}",
	// `local 1 var-destr · 2 var · 3 new` — the SAME numbering the middle column writes,
	// one line per file: the sequence of one side, then the sequence of the other.
	sequence: "{side}  {steps}",
	// `call ×2`
	block: "{kind} ×{count}",
	empty: "no run",
});

export {  PHRASES  };
