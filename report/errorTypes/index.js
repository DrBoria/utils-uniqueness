"use strict";

// The vocabulary of the report, in one place:
//
//   describeComp(comp) -> findings[]
//
// Every finding is the same SHAPE, whatever produced it, and every sentence comes
// from a CODE (`./codes`):
//
//   { id, code, params, kind, label, color,      what it says and how it looks
//     left, right,                                the two places (or one)
//     confidence, tier,                           the numbers
//     message,                                    render(code, params)
//     fix,                                        the repair, structured
//     decision,                                   per-signal scores + why lines
//     evidence, dropped, members }                the raw facts behind it
//
// This is the single producer: the markdown report, the HTML page and (through
// `render`) the ESLint message all consume the same objects. No renderer parses
// a sentence, and no producer writes one.

const { kindOf } = require("./vocabulary/labels");
const { render, kindOfCode } = require("./codes");
const { CODE, KIND, SIDE, TIER } = require("../../constants");
const { explain } = require("../../decision-maker");
const asks = require("../asks");

const place = (item) => ({
	name: item?.name ?? null,
	path: item?.path ?? null,
	line: item?.line ?? null,
	endLine: item?.endLine ?? item?.line ?? null,
	nodes: item?.nodes ?? null,
});

const conf = (value) => (Number.isFinite(value) ? value.toFixed(2) : "n/a");
const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a");

const finding = ({ id, code, params, left, right = null, fix, decision = null, evidence = {}, dropped = null, members = null, suffix = "" }) => {
	const kind = kindOfCode(code) ?? KIND.Similar;
	const meta = kindOf(kind);

	return {
		id,
		code,
		params,
		kind,
		label: meta.label,
		color: meta.color,
		left,
		right,
		confidence: decision ? decision.confidence : null,
		tier: decision ? decision.tier : null,
		message: `${render(code, params)}${suffix}`,
		fix,
		decision,
		evidence,
		dropped,
		members,
	};
};

const pairFinding = (match, { inLayer }) => {
	const decision = explain(match.decision, { nodes: match.app.nodes });
	// The tier IS the verdict: `decide()` sets both, and a caller that only kept
	// the tier (a test fixture, a replayed log) must not be re-read as "similar".
	const duplicate = match.decision.isDuplicate || match.decision.tier === TIER.Duplicate;
	const code = duplicate ? CODE.Duplicate : CODE.Similar;

	return finding({
		id: `${code}:${match.app.path}#${match.app.name}=>${match.canon.path}#${match.canon.name}`,
		code,
		params: {
			left: `\`${match.app.name}\``,
			right: `\`${match.canon.name}\``,
			confidence: `${conf(decision.confidence)} (${pct(decision.confidence)})`,
		},
		left: { ...place(match.app), side: inLayer ? SIDE.Utils : SIDE.App },
		right: { ...place(match.canon), side: SIDE.Utils },
		fix: asks.useCanonical(match.canon),
		decision,
		// The reason sentence the funnel already wrote. The per-signal numbers live
		// in `decision` — copying them here doubled the payload for no new fact.
		evidence: { reason: match.reason },
	});
};

const droppedFinding = (dropped, { inLayer }) => {
	const match = dropped.match;
	const decision = explain(match.decision, { nodes: match.app.nodes });
	// The filter's own reason goes through the SAME code table as everything else
	// ("{name} calls {other} — composition, not a duplicate"), so the CLI and the
	// page explain the dismissal with one wording.
	const why = render(dropped.code, dropped.params);

	return finding({
		id: `dropped:${match.app.path}#${match.app.name}=>${match.canon.path}#${match.canon.name}`,
		code: CODE.FilteredOut,
		params: {
			left: `\`${match.app.name}\``,
			right: `\`${match.canon.name}\``,
			confidence: `${conf(decision.confidence)} (${pct(decision.confidence)})`,
		},
		left: { ...place(match.app), side: inLayer ? SIDE.Utils : SIDE.App },
		right: { ...place(match.canon), side: SIDE.Utils },
		fix: asks.none(),
		decision,
		evidence: { filter: dropped.filter, filterCode: dropped.code, filterParams: dropped.params },
		// The dismissal is a second CODE, rendered by the same table — the sentence
		// is composed here so no renderer has to know how to append it.
		suffix: ` Filtered out by \`${dropped.filter}\`: ${why}`,
		dropped: { filter: dropped.filter, code: dropped.code, params: dropped.params, reason: why },
	});
};

const partFinding = (row, index, { inLayer }) => {
	const best = row.suggestions[0];
	const alternatives = row.suggestions.slice(1);

	return finding({
		id: `part:${row.path}:${row.line}-${row.endLine}#${index}`,
		code: CODE.PartDuplicate,
		params: {
			left: `\`${row.owner}\``,
			right: `\`${best.util}\` from \`${best.path}\``,
			confidence: `${conf(best.confidence)} (${pct(best.confidence)})`,
		},
		left: { name: `${row.owner} › <${row.tag}>`, path: row.path, line: row.line, endLine: row.endLine, side: inLayer ? SIDE.Utils : SIDE.App },
		right: { name: best.util, path: best.path, line: null, endLine: null, side: SIDE.Utils },
		fix: asks.useCanonical({ name: best.util, path: best.path }),
		evidence: { suggestions: row.suggestions, alternatives },
	});
};

const missingFinding = (cluster, index) => {
	const weakest = Math.min(...cluster.matches.map((m) => m.decision.confidence));
	const strongest = Math.max(...cluster.matches.map((m) => m.decision.confidence));

	return finding({
		id: `missing:${cluster.name}#${index}`,
		code: CODE.MissingUtil,
		params: {
			count: cluster.matches.length,
			right: `\`${cluster.canon.name}\` (\`${cluster.canon.path}\`)`,
			name: cluster.name,
			confidence: `${conf(weakest)}–${conf(strongest)}`,
		},
		left: null,
		right: { name: cluster.canon.name, path: cluster.canon.path, line: null, endLine: null, side: SIDE.Utils },
		fix: asks.moveToUtils(cluster.name, []),
		members: cluster.matches.map((m) => ({ ...place(m.app), side: SIDE.App, confidence: m.decision.confidence, reason: m.decision.reason })),
	});
};

const clusterFinding = (cluster, index) => {
	const weakest = cluster.members.reduce((min, m) => Math.min(min, m.confidence ?? 1), 1);

	return finding({
		id: `cluster:${cluster.name}#${index}`,
		code: CODE.CrossFileCopy,
		params: { count: cluster.members.length, confidence: conf(weakest) },
		left: null,
		right: null,
		fix: asks.moveToUtils(cluster.name, []),
		members: cluster.members.map((m) => ({ ...place(m), side: SIDE.App, confidence: m.confidence ?? null })),
	});
};

const trashFinding = (cluster, index) => {
	const member = cluster.members[0];

	return finding({
		id: `trash:${cluster.name}#${index}`,
		code: CODE.TrashOneLiner,
		params: {
			name: `\`${cluster.name}\``,
			why: `its body is ${member.trashScore ?? "a"} valueless comparison with no branch, call or assignment.`,
		},
		left: { ...place(member), side: SIDE.App },
		right: null,
		fix: asks.inline(member.name, member.rawText),
		members: cluster.members.map((m) => ({ ...place(m), side: SIDE.App, trashScore: m.trashScore ?? null })),
	});
};

// Every finding the run produced, in one flat list. The order is the reading
// order of the terminal report: verdicts first, then partials, then the
// structural advice (missing / cross-file / trash), then what was filtered out.
const describeComp = (comp) => {
	const folders = comp.layerFolders ?? [];
	const inLayer = (p) => folders.some((dir) => p.startsWith(dir));
	const out = [];

	for (const match of comp.matches ?? []) out.push(pairFinding(match, { inLayer: inLayer(match.app.path) }));
	(comp.parts ?? []).forEach((row, i) => out.push(partFinding(row, i, { inLayer: inLayer(row.path) })));
	const missing = (comp.missingClusters ?? []).filter((c) => c.matches.every((m) => !inLayer(m.app.path)));
	missing.forEach((cluster, i) => out.push(missingFinding(cluster, i)));
	(comp.appClusters ?? []).forEach((cluster, i) => out.push(clusterFinding(cluster, i)));
	(comp.trashClusters ?? []).forEach((cluster, i) => out.push(trashFinding(cluster, i)));
	(comp.dropped ?? []).forEach((d) => out.push(droppedFinding(d, { inLayer: inLayer(d.match.app.path) })));

	return out;
};

module.exports = { describeComp, pairFinding, partFinding, missingFinding, clusterFinding, trashFinding, droppedFinding, place, conf, pct };
