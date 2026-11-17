"use strict";

// Four comparison groups, each weighted. The verdict is the weight-normalized
// sum of the group scores, clamped to [0,1], then tiered against thresholds.
//
// Everything this file compares a number against comes from ./constants — the
// engine owns the ARITHMETIC, never the limits.

const {
	SIGNAL,
	SIGNAL_ORDER,
	TIER,
	VETO,
	DUPLICATE_GATES,
	SIMILAR_GATES,
	TONE,
	CODE,
	DEFAULT_WEIGHTS,
	DEFAULT_THRESHOLDS,
	GATE_LIMITS,
	TRASH_THRESHOLD,
	SUSPICIOUS_THRESHOLD,
	MAX_TRASH_DEPTH,
	MAX_TRASH_NODES,
	PREDICATE_NAME_RE,
	STATUS_FIELDS,
	BRANCH_KINDS,
	PREDICATE_KINDS,
	COMPARISON_OPS,
	LOGICAL_OPS,
	TRASH_OPS,
} = require("./constants");
import { combine, weighed } from "./evidence";

// The comparison groups, in the order the report reads them. Never a bare
// string: `SIGNAL.ControlFlow` cannot be mistyped into a group that silently
// stops being scored.
const GROUPS = SIGNAL_ORDER;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

const resolveWeights = (opts) => {
	const w = (opts && opts.weights) || {};
	const pick = (key) => w[key] ?? DEFAULT_WEIGHTS[key];

	return {
		[SIGNAL.Signature]: pick(SIGNAL.Signature),
		[SIGNAL.Structure]: pick(SIGNAL.Structure),
		[SIGNAL.Ast]: pick(SIGNAL.Ast),
		[SIGNAL.ControlFlow]: pick(SIGNAL.ControlFlow),
	};
};

const resolveThresholds = (opts) => {
	const t = (opts && opts.thresholds) || {};
	return {
		[TIER.Duplicate]: t[TIER.Duplicate] ?? DEFAULT_THRESHOLDS[TIER.Duplicate],
		[TIER.Similar]: t[TIER.Similar] ?? DEFAULT_THRESHOLDS[TIER.Similar],
	};
};

// A group is "inapplicable" (weight zeroed) when the candidate has no signal
// for it — e.g. a body too small to have a meaningful control-flow graph.
//
// NOTE: signature is NOT zeroed for partial candidates. A part (Block node)
// has no parameters, so its signature score is naturally ~0. Zeroing the
// weight would renormalize the remaining signals upward by ~43% (totalW 1.0
// → 0.7), letting structure-only matches (ast 0.2–0.5) cross the 0.6 similar
// threshold. Keeping the weight at 0.3 means the ~0 signature score correctly
// penalizes confidence: "I can't verify the interface matches, so I'm less
// confident." A byte-for-byte body copy (structure 1.0, ast 1.0, cf 1.0,
// sig 0.0) still scores 0.7 — above the 0.6 floor.
const applicableOf = (candidate) => ({
	[SIGNAL.Signature]: true,
	[SIGNAL.Structure]: !!candidate.tree,
	[SIGNAL.Ast]: !!candidate.tree && candidate.nodes >= 4,
	[SIGNAL.ControlFlow]: !!candidate.tree && candidate.nodes >= 4,
});

// A "duplicate" verdict on a trivial function is almost always a false
// positive: stubs (throw-only, nodeCount ~4), client factories (~2) and tiny
// passthroughs (~5) share coarse signature shapes and empty control-flow
// graphs, which inflates their weighted score. Only a candidate with at least
// a minimal real body may be promoted to the duplicate tier; trivial ones cap
// at "similar". A one-liner ternary has ~6 nodes, and when it is a true twin
// all four signals (including the AST veto) line up at ~1.00, so 6 is the
// floor that keeps stubs out without capping genuine one-liner duplicates.
const { MIN_DUPLICATE_NODES, SHORT_BODY_NODES, SHORT_BODY_DUPLICATE_CONFIDENCE, AST_VETO_THRESHOLD, PART_AST_FLOOR, FIND_LOOKUP_AST_VETO, TEMPLATE_AST_VETO, RETURN_ROLE_VETO_CONFIDENCE, NO_INTERFACE_SIGNATURE, NO_INTERFACE_MAX_NODES } = GATE_LIMITS;
const hasDuplicateWorthyStructure = (candidate) => (candidate.nodes || 0) >= MIN_DUPLICATE_NODES;

// Short bodies (6-7 nodes: one-liner ternaries, tiny guards) are so coarse
// that unrelated operations can share their whole shape — e.g.
// `n === undefined ? undefined : \`$${n.toLocaleString()}\`` vs
// `amount === undefined ? undefined : \`$${amount}/mo\``. For these, a
// duplicate verdict requires near-perfect agreement across all signals; a
// single weak signal (ast ~0.6) must keep the pair in the similar tier.
// Bodies of 8+ nodes carry enough structure for the normal threshold.
const shortBodyNeedsHigherBar = (candidate, confidence, thresholds) =>
	(candidate.nodes || 0) < SHORT_BODY_NODES &&
	confidence >= thresholds[TIER.Duplicate] &&
	confidence < SHORT_BODY_DUPLICATE_CONFIDENCE;

// The AST signal captures actual body structure (subtree multiset + sequence
// similarity). When a candidate has a real body (nodeCount >= 4, i.e. AST is
// applicable) but the AST score is low, the two functions simply do not look
// alike in their bodies — a coarse signature or control-flow match is not
// enough to call them duplicates. This veto prevents the "signature 0.95 +
// controlFlow 1.00 + AST 0.25 → 0.76 duplicate" false positives.
//
// Ground truth (real run): `teamKeyByValue` — `Object.keys(E).find(k => E[k]
// === val)` — scored AST 0.55 against `enumKeys` — `Object.keys(e).filter(...)`:
// same `Object.keys(...)` head, different chain, different operation. A true
// renamed copy of a real body scores AST ~1.00 (see money/cash/parseDay), so
// 0.6 keeps every verified true duplicate while vetoing the 0.77 FP.
//
// Raised to 0.75 after the subtree multiset was fixed (normalize/ast.js used to
// count every subtree once per level, which inflated `shared` and `union` and
// made every AST score slightly wrong). With the honest counts, the fixture
// pairs separate cleanly: every verified true twin scores AST 1.00, while the
// worst known false positive (`perMonth` — `` `$${amount}/mo` `` vs
// `moneyOrNone` — `` `$${n.toLocaleString()}` ``) reaches only 0.66. The floor
// sits between the two populations instead of on top of the FP.
const astVetoes = (candidate, astScore) =>
	!!candidate.tree && (candidate.nodes || 0) >= 4 && astScore < AST_VETO_THRESHOLD;

// A partial candidate (Block node) has no parameters, so its signature score
// against a no-param canon (e.g. `serialId`) is 0.95 — a no-param coincidence,
// not evidence the body is a copy. The duplicate tier is already gated by
// astVetoes (AST >= 0.65), but the similar tier has no such gate. Without one,
// structure-only matches (ast 0.15–0.26) cross the 0.6 confidence floor via
// the inflated signature score. A real body copy scores AST ~1.0; unrelated
// blocks score < 0.3. 0.5 sits safely between.
const partAstFloorVetoes = (candidate, astScore) =>
	candidate.partial && !!candidate.tree && (candidate.nodes || 0) >= 4 && astScore < PART_AST_FLOOR;

// A single-expression body that is a `collection.find(pred)?.prop` lookup.
// Every such one-liner shares the same pattern-level skeleton (member → find →
// member), so the structure and control-flow signals saturate at 1.00 and carry
// no discriminating information — only the AST signal (the actual predicate and
// the property accessed) tells a true renamed copy from an unrelated lookup.
// Ground truth (real run): splitGroupsValue over-matched answerOf / snomedIn /
// findVitalId at 0.70-0.78 (struct 1.00, cf 1.00, ast 0.54-0.63). A genuine
// copy scores ast ~1.00, so a higher AST bar vetoes the FPs while keeping real
// twins.
const isSingleExpressionBody = (tree) => !!tree && (tree.kind !== "block" || (tree.children || []).length === 1);
const isFindLookupBody = (candidate) => (candidate.calls || []).includes("find") && isSingleExpressionBody(candidate.tree);
const findLookupVetoes = (candidate, astScore) => isFindLookupBody(candidate) && astScore < FIND_LOOKUP_AST_VETO;

// A single-expression body that is a template literal. After Fix 7 the
// template's static text is part of the AST fingerprint, but the pattern-level
// skeleton of a template one-liner is still extremely coarse: two templates
// with the same number of interpolations share the whole pre-order kind
// sequence (template/lit/member/lit/…), so the sequence sub-score saturates at
// 1.00 and structure/control-flow follow. Only the subtree sub-score (the
// member accesses and the static text) carries discriminating information.
// Ground truth (real run): the allergies composite-key builder `keyOf`
// (`` `${row.system}|${row.code}` ``) over-matched `formatAtTime`
// (`` `${t.formatDay} at ${t.formatTime}` ``) at conf 0.92 — structure 1.00,
// controlFlow 1.00, ast 0.66 — because a composite-key builder and a
// timestamp display are different operations that share one skeleton. A
// genuine renamed copy of a template one-liner scores ast ~1.00, so a higher
// AST bar vetoes the FP while keeping real twins.
const isTemplateBody = (tree) => isSingleExpressionBody(tree) && tree.kind === "template";
const templateVetoes = (candidate, astScore) => isTemplateBody(candidate.tree) && astScore < TEMPLATE_AST_VETO;

// The return role is part of the interface. A duplicate that returns a
// different kind of thing is not a duplicate: `parseDay` (returns a `Day`)
// scored 0.88 against `formatIsoDay` (returns a display string) in the real
// run — same guard + try/catch skeleton, but parsing vs formatting, i.e.
// inverse operations. When the return roles do not match, a duplicate verdict
// requires near-perfect agreement on everything else; true renamed copies
// always share the return role.
const returnRoleVetoes = (signals, confidence) =>
	signals[SIGNAL.Signature].evidence.returnRoleMatch === false && confidence < RETURN_ROLE_VETO_CONFIDENCE;

// When the interfaces share nothing (parameter roles differ, return role
// differs, names differ) and the body is small, the structure and
// control-flow match is a coarse shape coincidence — e.g. a boolean check
// (`status === "a" || status === "b"`) vs a unit conversion
// (`(degC * 9) / 5 + 32`) scored 0.55 in the real run on signature 0.00.
// Small bodies have too little structure for the body signals to carry
// evidence on their own, so such pairs are dropped entirely (not even
// "similar"). Larger bodies (>= 12 nodes) keep the normal thresholds: there,
// a body that looks alike is meaningful evidence even if the interfaces
// diverged.
const noSharedInterface = (candidate, signals) =>
	!candidate.partial && signals[SIGNAL.Signature].score < NO_INTERFACE_SIGNATURE && (candidate.nodes || 0) < NO_INTERFACE_MAX_NODES;

const applicableWeights = (weights, applicable) =>
	Object.fromEntries(Object.entries(weights).map(([key, w]) => [key, applicable[key] === false ? 0 : w]));

// The gates that stop a pair from being a duplicate even when the score is high
// enough (the second list applies to the similar tier). Both come from the enum,
// so a gate can neither be misspelled here nor left out of the report's wording.
const DUPLICATE_VETOES = new Set(DUPLICATE_GATES);

const decide = (candidate, canon, ctx) => {
	const o: any = ctx || {};
	const thresholds = resolveThresholds(o);

	const signals: any = {};
	for (const key of GROUPS) {
		const s = o.signals && o.signals[key];
		signals[key] = { score: s ? clamp01(s.score) : 0, evidence: s && s.evidence ? s.evidence : {} };
	}

	// A group that observed NOTHING on either side (a pure-expression body has no
	// structural kinds and no flow steps) is not counter-evidence: its weight is
	// renormalized away, exactly like a partial candidate's inapplicable groups.
	// Groups that DID observe and found nothing keep their weight and their 0.
	const applicable: any = candidate.partial ? applicableOf(candidate) : {};
	for (const key of GROUPS) {
		if (signals[key].evidence.applicable === false) applicable[key] = false;
	}
	const weights: any = applicableWeights(resolveWeights(o), applicable);

	// Evidence, not an average of shares: each group's confidence is built from the
	// number of observations it made (one matching parameter can never be a certain
	// verdict), and the groups are averaged by their weight. Averaging — not adding —
	// because weak evidence on four groups is still weak evidence, it does not
	// corroborate itself into certainty.
	const totalW = GROUPS.reduce((sum, key) => sum + weights[key], 0);
	const confidence = totalW === 0 ? 0 : clamp01(GROUPS.reduce((sum, key) => sum + weights[key] * signals[key].score, 0) / totalW);

	let isDuplicate = false;
	let tier = null;
	// WHY a pair did not become a duplicate is as important as the score: the
	// report prints one sentence per veto, so a reader who sees "similar, 0.86"
	// also sees which gate held it back. Every gate that fired is named here —
	// the names are the vocabulary of the report, not an internal detail.
	const vetoes = [];
	if (!hasDuplicateWorthyStructure(candidate)) vetoes.push(VETO.Small);
	if (astVetoes(candidate, signals[SIGNAL.Ast].score)) vetoes.push(VETO.Ast);
	if (findLookupVetoes(candidate, signals[SIGNAL.Ast].score)) vetoes.push(VETO.FindLookup);
	if (templateVetoes(candidate, signals[SIGNAL.Ast].score)) vetoes.push(VETO.Template);
	if (returnRoleVetoes(signals, confidence)) vetoes.push(VETO.ReturnRole);
	if (shortBodyNeedsHigherBar(candidate, confidence, thresholds)) vetoes.push(VETO.ShortBody);
	if (noSharedInterface(candidate, signals)) vetoes.push(VETO.NoInterface);
	if (partAstFloorVetoes(candidate, signals[SIGNAL.Ast].score)) vetoes.push(VETO.PartAstFloor);
	const canDuplicate = vetoes.every((v) => !DUPLICATE_VETOES.has(v));
	if (confidence >= thresholds[TIER.Duplicate] && canDuplicate) {
		isDuplicate = true;
		tier = TIER.Duplicate;
	} else if (confidence >= thresholds[TIER.Similar] && SIMILAR_GATES.every((gate) => !vetoes.includes(gate))) {
		tier = TIER.Similar;
	}

	// The reason string is rendered by the shared code vocabulary, so the ESLint
	// message, the markdown report and the HTML page print the SAME words for the
	// same number.
	const parts = GROUPS.map((key) => `${key} ${signals[key].score.toFixed(2)}`);
	const reason = render(CODE.Confidence, { confidence: confidence.toFixed(2), signals: parts.join(", ") });

	return {
		isDuplicate,
		confidence,
		tier,
		reason,
		signals,
		thresholds,
		weights,
		vetoes,
	};
};

const bestOf = (matches) =>
	[...matches].sort((a, b) => b.decision.confidence - a.decision.confidence || a.canon.name.localeCompare(b.canon.name))[0] || null;

// ---------------------------------------------------------------------------
// Trash detection — a per-candidate decision, independent of any pairwise
// comparison. A function "carries no value" when its body is a trivial
// predicate (one comparison of a field against a literal, or an || chain of
// such): extracting it to utils would move noise, not logic — the comparison
// should be inlined at the call site.
//
// The decision works on the plain bodyTree (playgrounds/typescript.js), so it
// sees literal VALUES (isRemoved vs isAnnotated differ only in the constant)
// before any normalization renames identifiers.
//
// Gate (mandatory): the body is a PURE predicate tree (only
// bin/unary/unary-post/member/index/ident/lit nodes — no calls, no assigns,
// no branches) AND it CONTAINS a comparison. A plain field accessor
// (`set.length`) has no comparison, so it is a normal accessor, not trash; a
// body with a call (`trim(x) === "y"`) is not a pure predicate.
//
// Gate refinement: the body may only use comparison/logical operators
// (TRASH_OPS). An instanceof / in / arithmetic one-liner does real work.
//
// Scoring (0–100), per the spec:
//   +40  single expression comparing ONE field (the base is single-field;
//        a multi-field predicate encodes a rule and never gets the base)
//   +20  small tree (depth ≤ 4, ≤ 12 nodes)
//   +15  no branches (no if/for/while/switch/cond)
//   +10  no calls, no assignments, no side effects
//   +10  predicate name (is/has/can/should) comparing a status-like field
//        — a BONUS, not a gate: the body already proved the function is a
//        valueless one-liner, the name only sharpens the recommendation.
//
// The maximum is 95 — a status guard never reaches a suspiciously round 100.
// Thresholds: ≥ 70 → Trash; 40–69 → Suspicious; < 40 → normal.
// ---------------------------------------------------------------------------

const treeDepth = (node) => (node ? 1 + (node.children || []).reduce((m, c) => Math.max(m, treeDepth(c)), 0) : 0);

const countNodes = (node) => (node ? 1 + (node.children || []).reduce((n, c) => n + countNodes(c), 0) : 0);

// Walk the body collecting node kinds and the literals it compares against.
const walkTrash = (node, acc) => {
	if (!node) return acc;
	acc.kinds.add(node.kind);
	if (node.kind === "lit" && node.label && node.label !== "lit") acc.literals.push(node.label);
	for (const c of node.children || []) walkTrash(c, acc);
	return acc;
};

const isPurePredicateTree = (tree) => {
	const acc = { kinds: new Set(), literals: [] };
	walkTrash(tree, acc);
	for (const k of acc.kinds) {
		if (!PREDICATE_KINDS.has(k)) return { pure: false, acc };
	}
	return { pure: true, acc };
};

const containsComparison = (node) => {
	if (!node) return false;
	if (node.kind === "bin" && COMPARISON_OPS.has(node.label)) return true;
	return (node.children || []).some(containsComparison);
};

const onlyTrashOps = (node) => {
	if (!node) return true;
	if (node.kind === "bin" && !TRASH_OPS.has(node.label)) return false;
	return (node.children || []).every(onlyTrashOps);
};

const comparedField = (tree) => {
	// The field a comparison reads: the `status` in `set.status === "x"`.
	// Only meaningful for a single comparison or an || chain of comparisons.
	const compare = (node) => {
		if (!node || node.kind !== "bin") return false;
		if (!COMPARISON_OPS.has(node.label)) return false;
		const [l, r] = node.children || [];
		return (l && l.kind === "member") || (r && r.kind === "member");
	};
	if (LOGICAL_OPS.has(tree.label)) {
		const [l, r] = tree.children || [];
		if (!compare(l) || !compare(r)) return null;
	} else if (!compare(tree)) {
		return null;
	}
	const fields = new Set();
	const collect = (node) => {
		if (!node) return;
		if (node.kind === "member") fields.add(node.label);
		for (const c of node.children || []) collect(c);
	};
	collect(tree);
	return fields.size === 1 ? [...fields][0] : null;
};

const trashScore = (candidate) => {
	const tree = candidate && candidate.bodyTree;
	if (!tree) return 0;

	const { pure, acc } = isPurePredicateTree(tree);
	if (!pure || !containsComparison(tree) || !onlyTrashOps(tree)) return 0;

	// The base 40 is a SINGLE-FIELD comparison: `set.status === "x"` (or an
	// || chain over the same field) is a valueless status one-liner. A body
	// comparing several distinct fields (`kind !== X && category !== null`)
	// is a legitimate multi-condition predicate — it encodes a rule, so the
	// base does not apply and the score stays well under the trash threshold.
	const field = comparedField(tree);

	let score = 0;
	if (field) score += 40; // single expression comparing one field

	const depth = treeDepth(tree);
	const nodes = countNodes(tree);
	if (depth <= MAX_TRASH_DEPTH && nodes <= MAX_TRASH_NODES) score += 20;

	if (![...acc.kinds].some((k) => BRANCH_KINDS.has(k))) score += 15;

	if (!acc.kinds.has("call") && !acc.kinds.has("new") && !acc.kinds.has("assign") && !acc.kinds.has("var") && !acc.kinds.has("var-decl")) score += 10;

	// Predicate name + status-like field is a bonus, not a gate.
	const name = String((candidate && candidate.name) || "");
	if (field && PREDICATE_NAME_RE.test(name) && STATUS_FIELDS.has(field)) score += 10;

	return score;
};

// The trash concept only fits NAMED functions: a valueless one-liner like
// `isRemoved = (s) => s.status === "x"` should be inlined at the call site.
// An anonymous body (a synthetic `owner#anon@line` name — an inline .map() /
// .filter() callback) has nothing to inline: the matcher (trashScore) is
// correct about the body, but the verdict does not apply, so the filter cuts
// it out. Duplicates of anonymous bodies are a different question and are
// handled by the matchers, not by trash.
const isAnonymous = (candidate) => String((candidate && candidate.name) || "").includes("#anon@");

const isTrash = (candidate) => !isAnonymous(candidate) && trashScore(candidate) >= TRASH_THRESHOLD;


// ---------------------------------------------------------------------------
// The READER's copy of the verdict — still the same decision-maker.
//
// `decide()` above produces the numbers; `explain()` turns them into something a
// person can argue with: one row per comparison group with its score, weight,
// share of the final number and the raw evidence behind it, then one sentence per
// gate that fired. The HTML page and the markdown report both read THIS object,
// and the sentences come from the shared code vocabulary — so the number and its
// explanation can never disagree.
//
// There is deliberately ONE decision-maker: a second copy under `report/` drifted
// the moment the thresholds changed.
// ---------------------------------------------------------------------------

import { SIGNALS } from "./report/errorTypes/vocabulary/labels";
import { KIND } from "./constants";
import { PHRASES, fill } from "./report/errorTypes/vocabulary/phrases";
import { render } from "./report/errorTypes/codes";
import { num, pct, showValue } from "./report/errorTypes/vocabulary/format";
import { labelOfEvidence } from "./report/errorTypes/vocabulary/evidence";
import { gatePhrase } from "./report/errorTypes/vocabulary/gates";

const chips = (evidence) =>
	Object.entries(evidence ?? {})
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => ({ key, label: labelOfEvidence(key), value: showValue(value) }));

// One explanation per pair. `decision` is what `decide()` returned; `nodes` is
// the local function's node count when the caller has it (the small-body veto
// quotes it).
const explain = (decision, { nodes = null } = {}) => {
	const totalWeight = SIGNALS.reduce((sum, s) => sum + (decision.weights?.[s.key] ?? 0), 0) || 1;
	const rows = SIGNALS.map((signal) => {
		const score = decision.signals?.[signal.key]?.score ?? 0;
		const weight = decision.weights?.[signal.key] ?? 0;
		return {
			key: signal.key,
			label: signal.label,
			short: signal.short,
			color: signal.color,
			what: signal.what,
			score,
			weight,
			// The share of the final verdict this group produced — the number
			// that answers "what made it 0.87?".
			contribution: (weight * score) / totalWeight,
			applied: weight > 0,
			evidence: chips(decision.signals?.[signal.key]?.evidence),
		};
	});

	// The gates quote the score that failed them; the small-body gate quotes the
	// node count when the caller knows it.
	const gateContext = {
		ast: decision.signals?.[SIGNAL.Ast]?.score ?? 0,
		signature: decision.signals?.[SIGNAL.Signature]?.score ?? 0,
		nodes,
	};
	const why = [];
	for (const row of [...rows].sort((a, b) => b.contribution - a.contribution)) {
		if (!row.applied) {
			why.push({ tone: TONE.Off, signal: row.key, text: fill(PHRASES.signalOff, { label: row.label }) });
			continue;
		}
		const template = row.score >= 0.6 ? PHRASES.signal : PHRASES.signalDisagrees;
		why.push({
			tone: row.score >= 0.6 ? TONE.Agree : TONE.Disagree,
			signal: row.key,
			text: fill(template, { label: row.label, score: num(row.score), weight: pct(row.weight), what: row.what }),
		});
	}
	for (const veto of decision.vetoes ?? []) {
		const text = gatePhrase(veto, gateContext);
		if (!text) continue;
		why.push({ tone: TONE.Veto, signal: SIGNAL.Ast, text });
	}

	return {
		confidence: decision.confidence ?? 0,
		tier: decision.tier,
		verdict: decision.isDuplicate ? KIND.Duplicate : decision.tier === TIER.Similar ? KIND.Similar : "none",
		thresholds: decision.thresholds ?? {},
		weights: decision.weights ?? {},
		vetoes: decision.vetoes ?? [],
		signals: rows,
		why,
		// The one-line version, for a badge or a table cell: the number and the
		// group that produced most of it.
		headline: (() => {
			const top = [...rows].sort((a, b) => b.contribution - a.contribution)[0];
			return fill(PHRASES.headline, { confidence: num(decision.confidence), top: top ? top.label : "—", share: pct(top ? top.contribution : 0) });
		})(),
	};
};


export {
	explain,
	decide,
	bestOf,
	resolveWeights,
	resolveThresholds,
	clamp01,
	GROUPS,
	DEFAULT_WEIGHTS,
	DEFAULT_THRESHOLDS,
	trashScore,
	isTrash,
	isAnonymous,
	TRASH_THRESHOLD,
	SUSPICIOUS_THRESHOLD,
};
