"use strict";

// THE CONSTANTS FILE — every value of the tool that is not a computation.
//
// Nothing outside this file declares a threshold, a limit, a name or an enum
// value. Two reasons:
//
//   1. a typo. `"controlFlow"` written by hand in four modules silently disabled
//      a gate; `"duplicate"` misspelled silently demoted a verdict. Referencing a
//      frozen key makes that impossible — the name either exists or the code
//      throws;
//   2. ONE place to look. "What makes a body too small to call a duplicate?" is a
//      question with one answer, and it is here.
//
// SECTION INDEX (search by number, in order):
//    1  Comparison groups
//    2  Verdict tiers
//    3  Gates that stop a duplicate (and the same-tier gates)
//    4  Weights, thresholds, gate limits
//    5  Trash detection
//    6  Clustering and pair limits
//    7  Scan defaults (extensions, ignored dirs, repo markers, test excludes)
//    8  Library registry budgets
//    9  Findings: kinds and codes
//   10  Sides
//   11  Diff: row types and per-row marks
//   12  Diff and overview limits
//   13  Run: outcomes, filters, repairs, tones
//
// Values are plain strings/numbers on purpose: they travel in JSON to the page
// and are printed in reports, so they must read well.

// ═══ 1. Comparison groups ═══════════════════════════════════════════════════
const SIGNAL = Object.freeze({
	Signature: "signature",
	Structure: "structure",
	Ast: "ast",
	ControlFlow: "controlFlow",
});

const SIGNAL_ORDER = Object.freeze(Object.values(SIGNAL));

// ═══ 2. Verdict tiers ═══════════════════════════════════════════════════════
const TIER = Object.freeze({
	Duplicate: "duplicate",
	Similar: "similar",
});

// ═══ 3. Gates that stop a duplicate ═════════════════════════════════════════
const VETO = Object.freeze({
	Small: "small",
	Ast: "ast",
	FindLookup: "findLookup",
	Template: "template",
	ReturnRole: "returnRole",
	ShortBody: "shortBody",
	NoInterface: "noInterface",
	PartAstFloor: "partAstFloor",
});

// The gates that apply to the DUPLICATE tier only; the last two apply to the
// similar tier and are listed separately so the decision reads as two rules
// instead of one list with a comment.
const DUPLICATE_GATES = Object.freeze([VETO.Small, VETO.Ast, VETO.FindLookup, VETO.Template, VETO.ReturnRole, VETO.ShortBody]);
const SIMILAR_GATES = Object.freeze([VETO.NoInterface, VETO.PartAstFloor]);

// ═══ 4. Weights, thresholds, gate limits ════════════════════════════════════
// The four groups are weighted and averaged; the result is tiered against the
// two thresholds. A gate below is a limit that can veto a high score.
const DEFAULT_WEIGHTS = Object.freeze({
	[SIGNAL.Signature]: 0.3,
	[SIGNAL.Structure]: 0.3,
	[SIGNAL.Ast]: 0.2,
	[SIGNAL.ControlFlow]: 0.2,
});

const DEFAULT_THRESHOLDS = Object.freeze({
	// 0.75: measured on the engine's own corpus after every group became EVIDENCE
	// (`1 - (1-w)^n` per matched kind, combined). The confidence histogram of 545
	// findings is 0.60–0.69 → 101, 0.70–0.79 → 283, 0.80–0.89 → 113, 0.90+ → 48;
	// 0.75 cuts the band where four weak groups merely average out, and keeps every
	// pair on which several groups AGREE. Set `thresholds` in the ESLint config to
	// override it.
	[TIER.Duplicate]: 0.75,
	// 0.65: the useful floor. Below it the groups disagree more than they agree.
	[TIER.Similar]: 0.65,
});

const GATE_LIMITS = Object.freeze({
	// A body with fewer nodes than this is a stub / passthrough: it may be
	// similar, never a duplicate.
	MIN_DUPLICATE_NODES: 6,
	// Short bodies (up to this many nodes) are so coarse that a duplicate verdict
	// needs near-perfect agreement instead of the normal threshold.
	SHORT_BODY_NODES: 8,
	SHORT_BODY_DUPLICATE_CONFIDENCE: 0.95,
	// The AST group must agree at least this much for a duplicate verdict: below
	// it the bodies simply do not look alike, whatever the coarse groups say.
	AST_VETO_THRESHOLD: 0.75,
	// The same floor for a PARTIAL candidate (a block, no signature of its own).
	PART_AST_FLOOR: 0.5,
	// `find(...)` lookups and template one-liners share one skeleton, so their
	// AST bar is higher — the skeleton carries no information there.
	FIND_LOOKUP_AST_VETO: 0.85,
	TEMPLATE_AST_VETO: 0.85,
	// A different RETURN KIND means inverse operations (parse vs format): the
	// verdict needs near-perfect agreement to survive it.
	RETURN_ROLE_VETO_CONFIDENCE: 0.9,
	// Interfaces that share nothing, on a small body, are a shape coincidence.
	NO_INTERFACE_SIGNATURE: 0.3,
	NO_INTERFACE_MAX_NODES: 12,
});

// ═══ 5. Trash detection ══════════════════════════════════════════════════════
// A valueless one-liner (a status compared to a literal) should be inlined, not
// extracted. The score is 0-95; these are the two cuts.
const TRASH_THRESHOLD = 70;
const SUSPICIOUS_THRESHOLD = 40;
const MAX_TRASH_DEPTH = 4;
const MAX_TRASH_NODES = 12;
// A predicate name (is/has/can/should) over a status-like field is a bonus, not a
// gate — but both lists are vocabulary, so they live here.
const PREDICATE_NAME_RE = /^(is|has|can|should)[A-Z]/;
const STATUS_FIELDS = Object.freeze(new Set(["status", "state", "type", "kind"]));

// ═══ 5b. AST kind vocabulary ═════════════════════════════════════════════════
// Which tree kinds mean "a branch" (trash scoring, control flow) and which may
// appear in a pure predicate body (trash gate). Spelled once: a missing kind
// silently disabled a check.
const BRANCH_KINDS = Object.freeze(new Set(["if", "for", "for-of", "while", "do-while", "switch", "cond"]));
const PREDICATE_KINDS = Object.freeze(new Set(["bin", "unary", "unary-post", "member", "index", "ident", "lit"]));

// The operators a valueless one-liner may use. Anything else (instanceof, in,
// arithmetic) means the "one-liner" does real work.
const COMPARISON_OPS = Object.freeze(new Set(["EqualsEqualsEqualsToken", "ExclamationEqualsEqualsToken", "EqualsEqualsToken", "ExclamationEqualsToken"]));
const LOGICAL_OPS = Object.freeze(new Set(["BarBarToken", "AmpersandAmpersandToken"]));
const TRASH_OPS = Object.freeze(new Set([...COMPARISON_OPS, ...LOGICAL_OPS]));

// ═══ 5c. The complete node-kind language ════════════════════════════════════
// Every kind the plain-tree builder (playgrounds/typescript.js) can emit,
// grouped by the role it plays. This is the single source of truth: a kind is
// spelled here once, and no module keeps a private list that could drift.
const EXPRESSION_KINDS = Object.freeze([
	"ident", "member", "index", "lit", "bin", "unary", "unary-post", "cond", "seq",
	"spread", "object", "prop", "array", "template", "call", "new", "await", "yield", "func",
]);
const JSX_KINDS = Object.freeze(["jsx", "jsx-attr", "jsx-spread", "jsx-expr"]);
const STATEMENT_KINDS = Object.freeze([
	"if", "for", "for-of", "while", "do-while", "switch", "case", "return", "throw",
	"try", "catch", "var", "var-decl", "assign", "block", "expr",
]);
const AST_KINDS = Object.freeze(new Set([...EXPRESSION_KINDS, ...JSX_KINDS, ...STATEMENT_KINDS]));

// A body has "structure" when it contains one of these — a branch, a loop, or
// an interaction with the outside world.
const STRUCTURAL_KINDS = Object.freeze(new Set(["if", "for", "for-of", "while", "do-while", "switch", "try", "cond", "return", "throw", "call", "new"]));

// The ordered skeleton of a body (the control-flow signature).
const FLOW_KINDS = Object.freeze(new Set(["if", "for", "for-of", "while", "do-while", "switch", "try", "catch", "cond", "return", "throw", "await", "yield", "call", "new", "assign", "var", "var-destr"]));

// ── RARITY OF A FLOW STEP (the edge weight of the alignment) ───────────────
//
// Frequent → rare, and the step's number IS its rarity: a `call` is in every
// body and proves little, a `try`/`if` is rare and proves a lot. A declaration
// is split by its KEYWORD — `const`, `let` and `var` are different facts for
// control flow: `let` and `var` behave alike, `const` says more, and a
// destructuring pattern says more still. `new` is a step of its own.
//
// The alignment maximises the WEIGHT of the run, so a rare match outranks a
// frequent one: two rare steps beat three common ones.
const FLOW_RARITY = Object.freeze({
	call: 1,
	"var:let": 1.2,
	"var:var": 1.2,
	assign: 1.4,
	"var-destr": 1.6,
	await: 1.6,
	yield: 1.6,
	cond: 1.8,
	"var:const": 2,
	new: 2,
	case: 2,
	for: 2.2,
	"for-of": 2.2,
	while: 2.2,
	"do-while": 2.2,
	switch: 2.4,
	return: 2.5,
	throw: 2.5,
	if: 3,
	try: 3,
	catch: 3,
});
const FLOW_RARITY_DEFAULT = 2;

/** The weight of one step: how much a match of this kind proves. */
const flowRarity = (kind) => FLOW_RARITY[kind] ?? FLOW_RARITY_DEFAULT;

/**
 * The word a reader sees for a step. A declaration carries its KEYWORD in the step
 * key (`var:const`), because `const`/`let`/`var` are three different facts; the
 * reader gets the keyword alone. A step inside a block keeps its path, so
 * `if/var:const` reads `if/const`.
 */
const flowWord = (kind) => kind.replace(/(^|[/>])var:(const|let|var)/g, "$1$2");

// Kinds whose label is a name the code DECLARES: a variable binding, an object
// key, a JSX attribute. The normalizer reads these before it renames anything,
// so they are the names a copy keeps.
const DECLARING_KINDS = Object.freeze(new Set(["var-decl", "prop", "jsx-attr"]));

// Kinds whose label is a local identifier. The tree comparison replaces it with
// `v`, so `a + b` and `x + y` have the same shape; the label survives only in
// the name sites.
//
// `member` belongs here for the same reason: `params.pattern` and `params.query`
// are the same ACCESS with a renamed property — that is a rename, and the group
// that compares NAMES is signature, not the tree. Keeping the property name in the
// shape made two identical statements 33% apart.
const RENAMED_KINDS = Object.freeze(new Set(["ident", "var-decl", "member"]));

// What a body can DO to the outside world. `kinds` are the tree kinds that carry
// the effect, `what` is the sentence a report prints — the wording lives here,
// not in the module that detects it.
const SIDE_EFFECTS = Object.freeze([
	{ key: "calls", what: "invokes something (call / new)", kinds: ["call", "new"] },
	{ key: "assigns", what: "writes to a target", kinds: ["assign"] },
	{ key: "throw", what: "throws", kinds: ["throw"] },
	{ key: "await", what: "crosses an async boundary", kinds: ["await"] },
	{ key: "yield", what: "yields", kinds: ["yield"] },
]);

// Above this many nodes a body's shape is not a coincidence, whatever kinds it
// contains — the second reason `structure()` says "present".
const STRUCTURE_BY_SIZE_NODES = 12;

// ═══ 6. Clustering and pair limits ═══════════════════════════════════════════
// How similar two bodies must be before they are compared / clustered at all.
const SIZE_RATIO = 3; // a body more than 3x longer cannot be a copy of another
const MIN_PART_CANON_NODES = 1;
const MIN_PART_STATEMENTS = 3; // a partial duplicate is at least this long
const SIMILAR_FANOUT_CAP = 2; // a local util reports at most N "similar" canons
const MIN_STRUCTURE_NODES = 6; // drop-no-structure: below this a body is trivial
const MIN_TRASH_CLUSTER = 1; // a singleton one-liner is still trash
const DEFAULT_PAIR_FLOOR = 0.6; // app-pairs: mutual copies start here
const MIN_APP_CLUSTER = 2; // cross-file copies need at least this many members
const AST_COPY_FLOOR = 0.9; // app-pairs: "copy" (not just "similar") needs this
const MIN_COPY_PARAMS = 1; // app-pairs: a copy must take parameters
const DEFAULT_MIN_CLUSTER = 3; // missing-util: locals matching one canon
const MIN_PAIR_FLOOR = 0.9; // missing-util: a member must match this well
const CANON_CONF_FLOOR = 0.4; // missing-util: ignore a barely-related canon

// ═══ 7. Scan defaults ════════════════════════════════════════════════════════
const DEFAULT_EXTS = Object.freeze([".ts", ".tsx", ".js", ".jsx"]);
const DEFAULT_IGNORE_DIRS = Object.freeze(["node_modules", "dist", "build", "out", "coverage"]);
const DEFAULT_ROOT_MARKERS = Object.freeze([".git"]);
const DEFAULT_TEST_EXCLUDES = Object.freeze(["**/*.test.*", "**/*.spec.*", "**/*.e2e.*", "**/*.stories.*", "**/e2e/**"]);

// ═══ 7b. Rule identity and config file names ════════════════════════════════
const RULE_NAME = "md-code/utils-uniqueness";
const RULE_SHORT = "md-code";
// Where the rule's options are read from, in priority order.
const FLAT_CANDIDATES = Object.freeze(["md-code-utils-uniqueness.config.js", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"]);
const LEGACY_CANDIDATES = Object.freeze([".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml"]);

// ═══ 8. Library registry budgets ═════════════════════════════════════════════
// `proposeFromLib` parses installed .d.ts files; these keep a lint under a second.
const MAX_LIBS = 80;
const MAX_EXPORTS_PER_LIB = 2000;
const BUDGET_MS = 30000;

// ═══ 9a. Findings: kinds ═════════════════════════════════════════════════════
const KIND = Object.freeze({
	Duplicate: "duplicate",
	Similar: "similar",
	Part: "part",
	Missing: "missing",
	Cluster: "cluster",
	Trash: "trash",
	Dropped: "dropped",
});

// The kinds in reading order — a report that lists them never invents an order.
const KIND_LIST = Object.freeze(Object.values(KIND));

// ═══ 9b. Findings: codes (every sentence has one) ════════════════════════════
const CODE = Object.freeze({
	Duplicate: "duplicate",
	Similar: "similar",
	PartDuplicate: "partDuplicate",
	MissingUtil: "missingUtil",
	CrossFileCopy: "crossFileCopy",
	TrashOneLiner: "trashOneLiner",
	FilteredOut: "filteredOut",
	Confidence: "confidence",
	Headline: "headline",
	LibHint: "libHint",
	Composition: "composition",
	CompositionReverse: "compositionReverse",
	TrivialBody: "trivialBody",

	// Messages that are not about a finding: the run's own words.
	OptionValue: "optionValue",
	OptionInvalid: "optionInvalid",
	UnknownArgument: "unknownArgument",
	NoScanRoots: "noScanRoots",
	CatalogStale: "catalogStale",
	ConfigUnreadable: "configUnreadable",
	ParseFailed: "parseFailed",
	ParsePartsFailed: "parsePartsFailed",
	NoticeDetail: "noticeDetail",
	CatalogWriteFailed: "catalogWriteFailed",
	CatalogBudget: "catalogBudget",
	LibRegistryUnavailable: "libRegistryUnavailable",
	LibRegistryBudget: "libRegistryBudget",
	Crash: "crash",
});

// The one prefix every warning carries, so a line on stderr is attributable.
const WARN_PREFIX = "[utils-uniqueness] ";

// ═══ 10. Sides of a comparison ══════════════════════════════════════════════
const SIDE = Object.freeze({
	App: "app",
	Utils: "utils",
});

// ═══ 11a. Per-row annotation state (the diff gutter) ══════════════════════════
const MARK = Object.freeze({
	Same: "same",
	Differs: "differs",
});

// ═══ 11b. Diff row types ═══════════════════════════════════════════════════
const ROW = Object.freeze({
	Equal: "equal",
	Change: "change",
	Add: "add",
	Remove: "remove",
	Fold: "fold",
});

// ═══ 12. Diff, code reading and overview limits ═════════════════════════════
const DIFF_CONTEXT = 3; // unchanged lines kept around a change before folding
const MAX_WORD_TOKENS = 400; // above this a changed line is not word-diffed
const MAX_EXPANSIONS = 10; // nested callee diffs collected per pair
const MAX_EXPANSIONS_PER_PAIR = 4; // ... and kept in the payload
const EXPANSION_MIN_CONFIDENCE = 0.6; // below this a pair gets no expansions

// How a source line is cut into comparable words (identifiers, runs of space, and
// single punctuation marks) — the word diff highlights inside a changed line.
// NOT frozen: a global regex carries `lastIndex`, so freezing it breaks `match`.
const WORD_TOKEN_RE = /[\w$]+|\s+|[^\w$\s]/g;
// A call site inside a body: the name before an opening parenthesis.
const CALL_SITE_RE = /([A-Za-z_$][\w$]*)\s*\(/g;

// Words that are syntax, not call sites / not a differing name.
//
// Each word is written ONCE, in exactly one group below. Every larger set is a
// union of those groups, so no list re-states another list's words and no two
// lists can drift apart.
const BRANCH_CALL_WORDS = Object.freeze(["if", "else", "for", "while", "do", "switch", "return", "catch"]);
// Block openers that are always followed by something that is NOT a call:
// `case X:`, `throw new …`, `try {`, `finally {`.
const CLAUSE_WORDS = Object.freeze(["case", "throw", "try", "finally"]);
const DEFAULT_CLAUSE = Object.freeze(["default"]);
const FUNCTION_WORDS = Object.freeze(["function"]);
const BUILTIN_CALL_WORDS = Object.freeze(["super", "constructor"]);
const DECLARATION_WORDS = Object.freeze([...FUNCTION_WORDS, "const", "let", "var", "class", "extends", "implements", "interface", "type", "enum", "async"]);
const MODULE_WORDS = Object.freeze(["export", "import", "from", "as"]);
const LITERAL_WORDS = Object.freeze(["true", "false", "null", "undefined"]);
// Operators that are followed by a name rather than a call — and `instanceof`,
// which is always followed by a type.
const OPERATOR_CALL_WORDS = Object.freeze(["new", "typeof", "in", "of", "delete", "void", "await", "yield"]);
const OPERATOR_WORDS = Object.freeze([...OPERATOR_CALL_WORDS, "instanceof"]);
const MODIFIER_WORDS = Object.freeze(["static", "public", "private", "protected", "abstract", "declare", "namespace", "get", "set"]);
const BUILTIN_WORDS = Object.freeze(["this", ...BUILTIN_CALL_WORDS]);
const TYPE_WORDS = Object.freeze(["any", "boolean", "number", "string", "unknown", "never", "object", "symbol", "bigint", "keyof", "unique", "readonly"]);

const BLOCK_WORDS = Object.freeze([...BRANCH_CALL_WORDS, ...CLAUSE_WORDS]);

// Every reserved word of the language, built from the groups above.
const KEYWORDS = Object.freeze(new Set([...BLOCK_WORDS, ...DEFAULT_CLAUSE, ...DECLARATION_WORDS, ...MODULE_WORDS, ...LITERAL_WORDS, ...OPERATOR_WORDS, ...MODIFIER_WORDS, ...BUILTIN_WORDS, ...TYPE_WORDS]));

// The words a reader sees as the opener of a block, in the left-hand gutter.
const CODE_BRANCH_WORDS = Object.freeze(new Set(BLOCK_WORDS));

// The words that cannot be a call target: the block openers a call may follow,
// the operators a call may follow, `function`, and the two builtin names that are
// themselves called.
const CALL_KEYWORDS = Object.freeze(new Set([...BRANCH_CALL_WORDS, ...OPERATOR_CALL_WORDS, ...FUNCTION_WORDS, ...BUILTIN_CALL_WORDS]));

// The keyword vocabulary the annotation layer treats as syntax.
const CODE_KEYWORDS = Object.freeze(new Set([...BLOCK_WORDS, ...DEFAULT_CLAUSE, ...DECLARATION_WORDS, ...MODULE_WORDS, ...LITERAL_WORDS, ...OPERATOR_WORDS]));

// ═══ 13a. Outcomes the run records about a pair ══════════════════════════════
const OUTCOME = Object.freeze({
	Kept: "kept",
	Dropped: "dropped",
});

// ═══ 13b. The filters, by the name they report ═══════════════════════════════
const FILTER = Object.freeze({
	DropUsages: "drop-usages",
	DropNoStructure: "drop-no-structure",
});

// ═══ 13c. Actions a repair can carry ═════════════════════════════════════════
const ACTION = Object.freeze({
	UseCanonical: "use-canonical",
	FromLib: "from-lib",
	MoveToUtils: "move-to-utils",
	Inline: "inline",
	None: "none",
});

// ═══ 13d. Tone of a "why" line ══════════════════════════════════════════════
const TONE = Object.freeze({
	Agree: "agree",
	Disagree: "disagree",
	Veto: "veto",
	Off: "off",
});

module.exports = {
	// 1-3: names
	SIGNAL,
	SIGNAL_ORDER,
	TIER,
	VETO,
	DUPLICATE_GATES,
	SIMILAR_GATES,
	// 4-8: numbers and kind vocabulary, grouped
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
	EXPRESSION_KINDS,
	JSX_KINDS,
	STATEMENT_KINDS,
	AST_KINDS,
	STRUCTURAL_KINDS,
	FLOW_KINDS,
	FLOW_RARITY,
	flowRarity,
	flowWord,
	DECLARING_KINDS,
	RENAMED_KINDS,
	SIDE_EFFECTS,
	STRUCTURE_BY_SIZE_NODES,
	SIZE_RATIO,
	MIN_PART_CANON_NODES,
	MIN_PART_STATEMENTS,
	SIMILAR_FANOUT_CAP,
	MIN_STRUCTURE_NODES,
	MIN_TRASH_CLUSTER,
	DEFAULT_PAIR_FLOOR,
	MIN_APP_CLUSTER,
	AST_COPY_FLOOR,
	MIN_COPY_PARAMS,
	DEFAULT_MIN_CLUSTER,
	MIN_PAIR_FLOOR,
	CANON_CONF_FLOOR,
	DEFAULT_EXTS,
	DEFAULT_IGNORE_DIRS,
	DEFAULT_ROOT_MARKERS,
	DEFAULT_TEST_EXCLUDES,
	RULE_NAME,
	RULE_SHORT,
	FLAT_CANDIDATES,
	LEGACY_CANDIDATES,
	MAX_LIBS,
	MAX_EXPORTS_PER_LIB,
	BUDGET_MS,
	// 9-13: findings, sides, diff, run
	KIND,
	KIND_LIST,
	CODE,
	WARN_PREFIX,
	SIDE,
	MARK,
	ROW,
	OUTCOME,
	FILTER,
	ACTION,
	TONE,
	DIFF_CONTEXT,
	MAX_WORD_TOKENS,
	MAX_EXPANSIONS,
	MAX_EXPANSIONS_PER_PAIR,
	EXPANSION_MIN_CONFIDENCE,
	WORD_TOKEN_RE,
	CALL_SITE_RE,
	CALL_KEYWORDS,
	CODE_KEYWORDS,
	CODE_BRANCH_WORDS,
};
