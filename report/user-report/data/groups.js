"use strict";

const { KIND, SIDE, TIER } = require("../../../constants");

// Grouping utilities BY SIMILARITY — the page's main axis.
//
// The funnel compares every util against every other one and then decides each
// pair. A flat list of pairs hides the shape of the problem: eight helpers that
// all duplicate one canonical are ONE finding ("this util is being reinvented"),
// not eight. A group is that finding:
//
//   * a canonical group — every local util whose best match is the same
//     `utils/<file>#<name>`;
//   * a structural group — a missing util / cross-file copy / trash cluster,
//     which is already a group by construction.
//
// Members carry the per-pair numbers, so the group row can show the strongest
// and the weakest link, and opening the group opens every diff it contains.

const groupKey = (finding) => {
	if (finding.kind === KIND.Missing) return `missing:${finding.right?.name}#${finding.right?.path}`;
	if (finding.kind === KIND.Cluster) return null;

	return `canonical:${finding.right?.path}#${finding.right?.name}`;
};

const memberOf = (finding) => ({
	findingId: finding.id,
	name: finding.left?.name ?? finding.right?.name ?? "—",
	path: finding.left?.path ?? finding.right?.path ?? null,
	line: finding.left?.line ?? finding.right?.line ?? null,
	confidence: finding.confidence,
	tier: finding.tier,
	side: finding.left?.side ?? SIDE.App,
});

const buildGroups = (findings) => {
	const groups = new Map();

	for (const finding of findings) {
		if (finding.kind === KIND.Dropped || finding.kind === KIND.Trash) continue;
		const key = groupKey(finding);
		if (key == null) continue;
		if (!groups.has(key)) {
			groups.set(key, {
				id: key,
				kind: finding.kind,
				name: finding.kind === KIND.Missing ? finding.id.split(":").slice(1).join(":").split("#")[0] : `${finding.right?.name ?? "—"}`,
				canonical: finding.right ? { name: finding.right.name, path: finding.right.path, line: finding.right.line } : null,
				members: [],
				findingIds: [],
			});
		}
		const group = groups.get(key);
		group.members.push(memberOf(finding));
		group.findingIds.push(finding.id);
	}

	// Cluster findings are groups of their own (they have members already).
	for (const finding of findings) {
		if (finding.kind !== KIND.Cluster) continue;
		groups.set(finding.id, {
			id: finding.id,
			kind: KIND.Cluster,
			name: finding.id.split(":").slice(1).join(":").split("#")[0],
			canonical: null,
			members: (finding.members ?? []).map((m) => ({
				findingId: finding.id,
				name: m.name,
				path: m.path,
				line: m.line,
				confidence: m.confidence,
				tier: TIER.Similar,
				side: SIDE.App,
			})),
			findingIds: [finding.id],
		});
	}

	const list = [...groups.values()].map((group) => {
		const confidences = group.members.map((m) => m.confidence).filter((c) => Number.isFinite(c));
		group.count = group.members.length;
		group.maxConfidence = confidences.length ? Math.max(...confidences) : null;
		group.minConfidence = confidences.length ? Math.min(...confidences) : null;
		group.duplicates = group.members.filter((m) => m.tier === TIER.Duplicate).length;

		return group;
	});

	return list.sort((a, b) => (b.maxConfidence ?? 0) - (a.maxConfidence ?? 0) || b.count - a.count || a.name.localeCompare(b.name));
};

module.exports = { buildGroups, groupKey };
