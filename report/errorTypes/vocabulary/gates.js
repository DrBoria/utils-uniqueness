"use strict";

// The sentence each GATE produces when it fires.
//
// A gate is a rule ("AST must agree", "the body is too small"), and the report
// owes the reader the reason a high score stopped short of "duplicate". The
// templates live with the rest of the wording; the floors are read from
// `GATE_LIMITS` so the sentence can never quote a number the engine no longer
// uses.

const { VETO, GATE_LIMITS } = require("../../../constants");
const { PHRASES, fill } = require("./phrases");
const { num } = require("./format");

const floor = (value) => value.toFixed(2);

const GATE_PHRASES = Object.freeze({
	[VETO.Ast]: (d) => fill(PHRASES.vetoAst, { score: num(d.ast), floor: floor(GATE_LIMITS.AST_VETO_THRESHOLD) }),
	[VETO.FindLookup]: (d) => fill(PHRASES.vetoAst, { score: num(d.ast), floor: floor(GATE_LIMITS.FIND_LOOKUP_AST_VETO) }),
	[VETO.Template]: (d) => fill(PHRASES.vetoAst, { score: num(d.ast), floor: floor(GATE_LIMITS.TEMPLATE_AST_VETO) }),
	[VETO.ReturnRole]: () => PHRASES.vetoReturn,
	[VETO.Small]: (d) => fill(PHRASES.vetoSmall, { nodes: d.nodes ?? GATE_LIMITS.MIN_DUPLICATE_NODES }),
	[VETO.ShortBody]: (d) => fill(PHRASES.vetoSmall, { nodes: d.nodes ?? GATE_LIMITS.SHORT_BODY_NODES }),
	[VETO.NoInterface]: (d) => fill(PHRASES.vetoInterface, { score: num(d.signature) }),
	[VETO.PartAstFloor]: (d) => fill(PHRASES.vetoAst, { score: num(d.ast), floor: floor(GATE_LIMITS.PART_AST_FLOOR) }),
});

const gatePhrase = (veto, context) => {
	const phrase = GATE_PHRASES[veto];
	return phrase ? phrase(context) : null;
};

module.exports = { GATE_PHRASES, gatePhrase };
