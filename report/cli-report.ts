"use strict";

// The terminal / `--report` document. It is a MARKDOWN rendering of the same
// findings the HTML page draws — same ids, same numbers, same repair sentences
// — so a finding can be quoted in a PR description and looked up in the page by
// the id printed next to it.
//
// Layers: the verdicts for the app, then the same verdicts inside each utils
// folder (a folder may duplicate its own sibling), then the structural advice
// (missing util, cross-file copies, trash), then what a filter explained away.

import { describeComp } from "./errorTypes";
import { TIER_LABEL, signalOf } from "./errorTypes/vocabulary/labels";
import { describe as describeMatchers } from "./matchers";
import { KIND, TIER, SIDE, TONE } from "../constants";

import { takeNotices } from "./notices";

const table = (headers, rows) => {
	const lines = [];
	lines.push(`| ${headers.join(" | ")} |`);
	lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
	for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
	lines.push("");
	return lines;
};

const loc = (p) => (p?.line ? `\`${p.path}:${p.line}\`` : `\`${p?.path ?? "—"}\``);

const renderHeader = (comp, findings, topPairs) => {
	// The header must count exactly what the sections below show. When the config
	// has a real app side, the verdict counts cover it only (duplicates inside a
	// utils folder get their own "Inside <folder>" section); when the utilsFolder
	// IS the scanned root, there is no app side and every pair is counted.
	const count = (kind) => topPairs.filter((f) => f.kind === kind).length;
	const trashMembers = findings.filter((f) => f.kind === KIND.Trash).reduce((n, f) => n + (f.members?.length ?? 0), 0);
	const trashGroups = findings.filter((f) => f.kind === KIND.Trash).length;
	const missingGroups = findings.filter((f) => f.kind === KIND.Missing);
	const clusterGroups = findings.filter((f) => f.kind === KIND.Cluster);
	const parts = [
		`Found ${count(KIND.Duplicate)} duplicate util(s) and ${count(KIND.Similar)} similar util(s)`,
		count(KIND.Part) > 0 ? `, plus ${count(KIND.Part)} partial duplicate(s)` : "",
		missingGroups.length > 0 ? `, plus ${missingGroups.reduce((n, f) => n + (f.members?.length ?? 0), 0)} util(s) grouped under ${missingGroups.length} potentially missing util(s)` : "",
		clusterGroups.length > 0 ? `, plus ${clusterGroups.reduce((n, f) => n + (f.members?.length ?? 0), 0)} util(s) in ${clusterGroups.length} cross-file copy group(s)` : "",
		trashMembers > 0 ? `, plus ${trashMembers} valueless one-liner(s) flagged as trash in ${trashGroups} group(s)` : "",
	];
	const lines = [];
	lines.push("# Utility duplicates (function-level funnel)");
	lines.push("");
	lines.push(`Scanned ${comp.files} app file(s), ${comp.appCount} app util(s) against ${comp.canonCount} canonical util(s).`);
	lines.push("");
	lines.push(`${parts.filter(Boolean).join("")}.`);
	lines.push("");

	return lines;
};

// One row per verdict: the numbers, the top signal and the repair. The id is
// printed IN FULL and unescaped, so it can be pasted into the page's deep link
// (`#/pair?id=…`) — truncating it made the row unusable for that.
const verdictRows = (rows) =>
	rows.map((f) => [
		`\`${f.id}\``,
		`${f.left?.name ?? "—"}`,
		loc(f.left),
		`${f.right?.name ?? "—"}`,
		loc(f.right),
		`${f.confidence != null ? f.confidence.toFixed(2) : "—"}`,
		f.decision ? `${f.decision.signals.reduce((top, s) => (s.contribution > top.contribution ? s : top), f.decision.signals[0]).label}` : "—",
		f.fix?.text ?? "",
	]);

// The same four explanations the page draws, as markdown: what the signature
// table, the construct table, the step alignment and the two trees show. Without
// them "confidence 0.66" is a number nobody can check in a terminal.
const matcherBlocks = (candidates, finding) => {
	const left = candidates.get(`${finding.left?.path}#${finding.left?.name}`);
	const right = candidates.get(`${finding.right?.path}#${finding.right?.name}`);
	const blocks = describeMatchers(left, right);
	if (blocks.length === 0) return [];

	// The group's name, then its ledger: numbers and positions, nothing else.
	const lines = [];
	for (const block of blocks) {
		const [first, ...rest] = block.lines;
		lines.push(`  ${signalOf(block.key).label}  ${first}`);
		for (const line of rest) lines.push(`    ${line}`);
	}

	return lines;
};

// ONE finding, ONE block: the verdict sentence, every reason, each matcher's own
// lines, the repair. Both the markdown report and the HTML page print this — the
// page does not re-word it, so the two cannot drift apart.
const findingBlock = (f, candidates = new Map()) => {
	const lines = [`- **${f.left?.name ?? "—"}** — ${f.message}`];
	// The four "agrees at …" sentences were four lines of the same fact. One line
	// states every score; the group sections below say WHAT was compared.
	const scores = (f.decision?.signals ?? []).filter((signal) => signal.applied).map((signal) => `${signal.label} ${Math.round(signal.score * 100)}%`);
	if (scores.length > 0) lines.push(`  scores  ${scores.join("  ·  ")}`);
	// Gates are not scores: a veto says WHY the pair cannot be a copy, so it stays.
	for (const why of f.decision?.why ?? []) if (why.tone === TONE.Veto) lines.push(`  ! ${why.text}`);
	lines.push(...matcherBlocks(candidates, f));
	lines.push(`  **Fix** — ${f.fix?.text ?? ""}`);

	return lines;
};

// The same block, plus the row the table carries above it: the id, the two names
// with their locations, the confidence and the signal that decided it. This is
// the whole console entry for one finding, as a single string.
const findingText = (f, candidates = new Map()) => {
	const top = f.decision ? f.decision.signals.reduce((best, s) => (s.contribution > best.contribution ? s : best), f.decision.signals[0]) : null;
	const head = [
		`\`${f.id}\``,
		`${f.left?.name ?? "—"}  ${loc(f.left)}  →  ${f.right?.name ?? "—"}  ${loc(f.right)}`,
		`confidence ${f.confidence != null ? f.confidence.toFixed(2) : "—"}${top ? ` · top signal ${top.label}` : ""}`,
		"",
	];

	return [...head, ...findingBlock(f, candidates)].join("\n");
};

const renderTier = (tier, findings, candidates = new Map()) => {
	const rows = findings.filter((f) => f.kind === tier).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
	if (rows.length === 0) return [];

	const lines = [];
	lines.push(`## ${TIER_LABEL[tier]} (${rows.length})`);
	lines.push("");
	lines.push(...table(["Id", "Local util", "Location", "Canonical", "Canonical location", "Confidence", "Top signal", "Fix"], verdictRows(rows)));
	lines.push("### Why each one matched");
	lines.push("");
	for (const f of rows) lines.push(...findingBlock(f, candidates));
	lines.push("");

	return lines;
};

const renderParts = (findings) => {
	if (findings.length === 0) return [];

	return [
		`## Partial duplicates (${findings.length})`,
		"",
		...table(
			["Part", "Location", "Replace with", "From", "Confidence", "Why"],
			findings.map((f) => [`${f.left?.name ?? "—"}`, loc(f.left), `\`${f.right?.name ?? "—"}\``, `\`${f.right?.path ?? "—"}\``, f.confidence != null ? f.confidence.toFixed(2) : "—", f.message]),
		),
	];
};

const renderMembers = (title, intro, findings) => {
	if (findings.length === 0) return [];

	const lines = [title, "", intro, ""];
	for (const f of findings) {
		lines.push(`### ${f.id.split(":").slice(1).join(":").split("#")[0]}`);
		lines.push("");
		lines.push(f.message);
		lines.push("");
		lines.push(...table(["Function", "Location", "Confidence"], (f.members ?? []).map((m) => [`${m.name}`, loc(m), m.confidence != null ? m.confidence.toFixed(2) : "—"])));
		lines.push(`**Fix** — ${f.fix?.text ?? ""}`);
		lines.push("");
	}

	return lines;
};

const renderFolderSections = (comp, findings) => {
	const folders = comp.layerFolders ?? [];
	if (folders.length === 0) return [];
	const inLayer = findings.filter((f) => (f.kind === KIND.Duplicate || f.kind === KIND.Similar) && f.left?.side === SIDE.Utils);

	const lines = [];
	for (const folder of folders) {
		const rows = inLayer.filter((f) => String(f.left?.path ?? "").startsWith(folder));
		if (rows.length === 0) continue;
		lines.push(`## Inside \`${folder}\` — utils folder duplicates (${rows.length})`);
		lines.push("");
		lines.push(...table(["Local util", "Location", "Canonical", "Canonical location", "Confidence", "Top signal", "Fix"], verdictRows(rows).map((r) => r.slice(1))));
	}

	return lines;
};

const renderFiltered = (findings) => {
	if (findings.length === 0) return [];

	return [
		`## Filtered out (${findings.length})`,
		"",
		...table(
			["Local util", "Location", "Canonical", "Filter", "Why dropped"],
			findings.map((f) => [`${f.left?.name ?? "—"}`, loc(f.left), `\`${f.right?.name ?? "—"}\``, `\`${f.dropped?.filter ?? "—"}\``, f.dropped?.reason ?? ""]),
		),
	];
};

const renderNotices = (notices) => {
	if (!notices.length) return "";
	const lines = ["", `## Not read (${notices.length})`, ""];
	for (const line of notices) lines.push(`- ${line}`);
	lines.push("");

	return lines.join("\n");
};

// `verbose` keeps the filtered-out section: the rows a heuristic explained away
// are the answer to "why is this duplicate missing?", so they are printed last.
// `notices` are the caveats the run collected; the caller passes them in so both
// artifacts (markdown and HTML) show the SAME ones.
//
// A config whose `utilsFolder` IS the scanned root has no app side: every pair is
// "inside" it, and splitting on that would hide the whole report behind one
// folder section. The split is therefore used only when it splits something.
const renderUtilsReport = (comp, verbose, notices = takeNotices()) => {
	const findings = comp.findings ?? describeComp(comp);
	const isPair = (f) => f.kind === KIND.Duplicate || f.kind === KIND.Similar;
	const appPairs = findings.filter((f) => isPair(f) && f.left?.side !== SIDE.Utils);
	const split = appPairs.length > 0;
	const topPairs = split ? appPairs : findings.filter(isPair);
	const lines = [];

	lines.push(...renderHeader(comp, findings, topPairs));
	const candidates = new Map([...(comp.appUtils ?? []), ...(comp.canonUtils ?? [])].map((candidate) => [`${candidate.path}#${candidate.name}`, candidate]));
	lines.push(...renderTier(TIER.Duplicate, topPairs, candidates));
	lines.push(...renderTier(TIER.Similar, topPairs, candidates));
	lines.push(...renderParts(findings.filter((f) => f.kind === KIND.Part)));
	lines.push(
		...renderMembers(
			`## Potentially missing util (${findings.filter((f) => f.kind === KIND.Missing).length})`,
			"Several distinct utils all matched the same canonical. The codebase is missing a shared util that would unify them — not that any single one is a duplicate.",
			findings.filter((f) => f.kind === KIND.Missing),
		),
	);
	lines.push(
		...renderMembers(
			`## Worth moving to utils — cross-file copies (${findings.filter((f) => f.kind === KIND.Cluster).length})`,
			"These functions are near-identical copies of each other across app files, with no canonical util to point at. Extract one shared util and call it from everywhere in the group.",
			findings.filter((f) => f.kind === KIND.Cluster),
		),
	);
	lines.push(
		...renderMembers(
			`## Trash — inline these (${findings.filter((f) => f.kind === KIND.Trash).length})`,
			"These carry no value as standalone functions: a single comparison of a status-like field against a literal. Delete the function and inline the comparison at the call site.",
			findings.filter((f) => f.kind === KIND.Trash),
		),
	);
	lines.push(...renderFolderSections(comp, split ? findings : []));
	if (verbose) lines.push(...renderFiltered(findings.filter((f) => f.kind === KIND.Dropped)));

	if (notices.length) lines.push(renderNotices(notices));

	return lines.join("\n");
};

export {  renderUtilsReport, renderTier, renderNotices, findingBlock, findingText  };
