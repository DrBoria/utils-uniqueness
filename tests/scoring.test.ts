import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { matchStructure, bagJaccard: structBag } = require("../matcher/structure.js");
const { matchControlFlow, bagJaccard: cfBag } = require("../matcher/control-flow.js");
const { buildSignature, shapeHash } = require("../normalize/signature.js");
const { decide } = require("../decision-maker.js");

// A minimal candidate/canon pair factory. Only the fields each matcher reads
// are populated; everything else is inert.
const mk = (over: Record<string, unknown> = {}) => ({
	name: "f",
	tree: null,
	sideEffectKeys: [],
	controlFlow: { sequence: [], cfg: { kinds: [] }, defUse: { ratio: 0 } },
	signature: { name: "f", roles: [], returnRole: "other", shapeHash: "", signatureKey: "" },
	...over,
});

describe("bagJaccard — empty-bag degeneracy", () => {
	it("returns 0 (not 1) for two empty bags", () => {
		expect(structBag(new Map(), new Map())).toBe(0);
		expect(cfBag(new Map(), new Map())).toBe(0);
	});

	it("returns 0 when only one bag is empty", () => {
		const a = new Map([["return", 1]]);
		expect(structBag(a, new Map())).toBe(0);
		expect(structBag(new Map(), a)).toBe(0);
	});

	it("still returns 1 for two identical non-empty bags", () => {
		const a = new Map([["return", 1], ["call", 2]]);
		expect(structBag(a, new Map([["return", 1], ["call", 2]]))).toBe(1);
	});
});

describe("matchControlFlow — trivial functions must not score 1.0", () => {
	it("two empty control flows are not perfectly similar", () => {
		const a = mk({ controlFlow: { sequence: [], cfg: { kinds: [] }, defUse: { ratio: 0 } } });
		const b = mk({ controlFlow: { sequence: [], cfg: { kinds: [] }, defUse: { ratio: 0 } } });
		const { score } = matchControlFlow(a, b);
		expect(score).toBeLessThan(1);
	});
});

describe("shapeHash — coarse collisions", () => {
	it("distinguishes different parameter counts", () => {
		const one = shapeHash(["string"], "string");
		const two = shapeHash(["string", "string"], "string");
		expect(one).not.toBe(two);
	});

	it("distinguishes different role sequences", () => {
		const ab = shapeHash(["string", "object"], "string");
		const ba = shapeHash(["object", "string"], "string");
		expect(ab).not.toBe(ba);
	});
});

describe("trivial functions are not flagged as duplicates", () => {
	// Mirrors the real false positive: optStr (v: string|null|undefined => string|undefined)
	// vs initialsOf (name: string|undefined => string|undefined) — both are one-liners
	// and were scored 0.82 "duplicate".
	const trivialPair = () => {
		const app = mk({
			nodeCount: 6,
			tree: { kind: "return", children: [] },
			signature: buildSignature({ name: "optStr", params: [{ name: "v", type: "string|null|undefined" }], returnType: "string|undefined" }),
		});
		const canon = mk({
			nodeCount: 20,
			tree: { kind: "call", children: [] },
			signature: buildSignature({ name: "initialsOf", params: [{ name: "name", type: "string|undefined" }], returnType: "string|undefined" }),
		});
		const signals = {
			signature: { score: 0.95, evidence: {} },
			structure: { score: 0.85, evidence: {} },
			ast: { score: 0.41, evidence: {} },
			controlFlow: { score: 1.0, evidence: {} },
		};
		return { app, canon, signals };
	};

	it("a low-complexity candidate is demoted out of the duplicate tier", () => {
		const { app, canon, signals } = trivialPair();
		const decision = decide(app, canon, { signals, weights: { signature: 0.3, structure: 0.3, ast: 0.2, controlFlow: 0.2 }, thresholds: { duplicate: 0.7, similar: 0.5 } });
		expect(decision.tier).not.toBe("duplicate");
	});
});

describe("AST veto — a real body that does not look alike is not a duplicate", () => {
	// Mirrors the real false positives after the receiver fix: parseArgs vs
	// parseKey (sig 0.95, struct 0.83, ast 0.34, cf 1.00 -> 0.80 "duplicate"),
	// useCreateProblem vs getChompMeter (sig 1.00, struct 0.82, ast 0.31,
	// cf 0.78 -> 0.76). The bodies are genuinely different, so the low AST
	// score must veto the duplicate tier even when the coarse signals inflate
	// the weighted sum past the threshold.
	const ctx = { weights: { signature: 0.3, structure: 0.3, ast: 0.2, controlFlow: 0.2 }, thresholds: { duplicate: 0.7, similar: 0.5 } };

	it("a substantive candidate with a low AST score is not a duplicate", () => {
		const app = mk({ nodeCount: 40, tree: { kind: "block", children: [] } });
		const canon = mk({ nodeCount: 40, tree: { kind: "block", children: [] } });
		const signals = {
			signature: { score: 0.95, evidence: {} },
			structure: { score: 0.83, evidence: {} },
			ast: { score: 0.34, evidence: {} },
			controlFlow: { score: 1.0, evidence: {} },
		};
		const decision = decide(app, canon, { signals, ...ctx });
		// The weighted sum is ~0.85, comfortably above the 0.7 threshold, but
		// the AST score (0.34) is far below the veto line, so it must not be a
		// duplicate.
		expect(decision.confidence).toBeGreaterThan(0.7);
		expect(decision.tier).not.toBe("duplicate");
	});

	it("a substantive candidate with a high AST score stays a duplicate", () => {
		const app = mk({ nodeCount: 40, tree: { kind: "block", children: [] } });
		const canon = mk({ nodeCount: 40, tree: { kind: "block", children: [] } });
		const signals = {
			signature: { score: 0.95, evidence: {} },
			structure: { score: 0.83, evidence: {} },
			ast: { score: 0.91, evidence: {} },
			controlFlow: { score: 1.0, evidence: {} },
		};
		const decision = decide(app, canon, { signals, ...ctx });
		expect(decision.tier).toBe("duplicate");
	});
});

describe("similar-tier floor — the weak tail is not reported", () => {
	// Empirical finding (chomp-2 real run, 3388 "similar" rows): 72% sit at
	// confidence 0.50-0.60, barely above chance on a 4-signal weighted average
	// where 0.50 means "half the signals agree". That is not a useful "similar"
	// signal. Raising the default similar floor from 0.5 to 0.6 drops that tail
	// while leaving the 0.60+ rows (and every verified true duplicate, which
	// lives in the 0.7+ duplicate tier) untouched.
	const weakPair = () => {
		const app = mk({ nodeCount: 20, tree: { kind: "block", children: [] } });
		const canon = mk({ nodeCount: 20, tree: { kind: "block", children: [] } });
		// 0.8*0.3 + 0.5*0.3 + 0.4*0.2 + 0.4*0.2 = 0.55 — above the old 0.5 floor,
		// below the new 0.6 floor.
		const signals = {
			signature: { score: 0.8, evidence: {} },
			structure: { score: 0.5, evidence: {} },
			ast: { score: 0.4, evidence: {} },
			controlFlow: { score: 0.4, evidence: {} },
		};
		return { app, canon, signals };
	};

	it("defaults the similar floor to 0.6 (not 0.5)", () => {
		const { app, canon, signals } = weakPair();
		const decision = decide(app, canon, { signals });
		expect(decision.thresholds.similar).toBe(0.6);
	});

	it("does not report a 0.55-confidence pair as similar under the default floor", () => {
		const { app, canon, signals } = weakPair();
		const decision = decide(app, canon, { signals });
		expect(decision.confidence).toBeCloseTo(0.55, 5);
		expect(decision.tier).not.toBe("similar");
	});

	it("still reports a 0.62-confidence pair as similar under the default floor", () => {
		const { app, canon } = weakPair();
		// 0.9*0.3 + 0.5*0.3 + 0.4*0.2 + 0.6*0.2 = 0.62 — just above the 0.6 floor.
		const signals = {
			signature: { score: 0.9, evidence: {} },
			structure: { score: 0.5, evidence: {} },
			ast: { score: 0.4, evidence: {} },
			controlFlow: { score: 0.6, evidence: {} },
		};
		const decision = decide(app, canon, { signals });
		expect(decision.confidence).toBeCloseTo(0.62, 5);
		expect(decision.tier).toBe("similar");
	});
});
