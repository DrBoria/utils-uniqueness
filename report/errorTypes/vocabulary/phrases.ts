"use strict";

// Every sentence the report prints about a verdict lives here, as a template
// with `{placeholders}`. A producer states the FACTS (names, paths, numbers);
// the wording is chosen here, once, so the terminal report and the HTML page
// cannot drift apart, and a new sentence is a one-line addition instead of a
// string buried in a renderer.

const fill = (template, vars) =>
	String(template).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key) =>
		vars[key] != null ? String(vars[key]) : `{${key}}`,
	);

const PHRASES = {
	// ── Verdicts ────────────────────────────────────────────────────────────
	duplicate: "{left} repeats the canonical {right} — {confidence} confidence that this is the same logic.",
	similar: "{left} looks like the canonical {right}, but not closely enough to call it a copy — {confidence}.",
	partDuplicate: "This block inside {left} repeats {right} — {confidence}.",
	missing: "{count} utils all matched {right}. They are close to one another but none is a clean copy — a shared {name} is missing.",
	cluster: "{count} cross-file copies of the same logic. Nothing canonical exists yet, so the fix is one shared util — weakest link {confidence}.",
	trash: "{name} carries no value of its own: {why} Inline it at the call site.",

	// ── Why it matched ──────────────────────────────────────────────────────
	headline: "{confidence} confidence — {top} contributes {share} of it.",
	signal: "{label} agrees at {score} ({weight} of the verdict) — it compares {what}.",
	signalDisagrees: "{label} agrees only at {score} ({weight} of the verdict) — it compares {what}.",
	signalOff: "{label} is not applicable to this pair, its weight was dropped.",

	// ── Why it did NOT become a duplicate ───────────────────────────────────
	vetoAst: "The bodies do not look alike: AST {score} is below the {floor} veto floor, so the coarse signals cannot promote this to a duplicate.",
	vetoReturn: "The two return different kinds of value, so they are inverse operations rather than copies.",
	vetoSmall: "The body is too small ({nodes} nodes) to be called a duplicate on shape alone.",
	vetoInterface: "The interfaces share nothing (signature {score}) and the body is small — a shape coincidence, not a copy.",
	vetoFloor: "Confidence {confidence} is under the {threshold} floor for the tier.",


	// ── The number itself ───────────────────────────────────────────────────
	// ONE sentence for "why this confidence", used by the ESLint message, the
	// terminal report and the page. It is the reason string the decision carries.
	confidence: "confidence {confidence} ({signals})",

	// ── Why a pair was dismissed (the filters) ──────────────────────────────
	filterComposition: "{local} calls {other} — composition, not a duplicate",
	filterCompositionReverse: "{other} calls {local} — composition, not a duplicate",
	filterTrivialBody: "{name} is a trivial body ({nodes} nodes) — not a meaningful duplicate",

	libHint: " Consider using {list} instead of a local implementation.",

	// ── Repairs ─────────────────────────────────────────────────────────────
	fixUseCanonical: "Replace the local body with a call to `{name}` from `{path}`.",
	fixFromLib: "Or use `{name}` from `{lib}` — the dependency is already installed.",
	fixMoveToUtils: "Extract a single `{name}` into {folder} and call it from every site below.",
	fixInline: "Delete `{name}` and write `{body}` where it is used.",
	fixKeep: "No action needed beyond the note.",

	// ── Caveats ─────────────────────────────────────────────────────────────
	notRead: "{path} was not read: {reason}",
	noCatalog: "No catalog at {path} — only live pairs were compared.",
};

export {  PHRASES, fill  };
