"use strict";

// ---------------------------------------------------------------------------
// Trash clustering.
//
// The per-candidate DECISION (is this function a valueless one-liner?) lives in
// decision-maker.js — `trashScore` / `isTrash` — so it is available BEFORE any
// pairwise comparison, exactly like `decide`. This module only groups the
// already-decided trash functions into clusters:
//
//   splitTrashClusters  — a "worth moving" cluster becomes a trash cluster only
//                         when EVERY member is trash; one member with real logic
//                         keeps the group a legitimate "worth moving" candidate.
//   collectTrashClusters — status guards are logical duplicates of their
//                         siblings (same comparison, different constant), but the
//                         literal values are part of the AST fingerprint, so such
//                         pairs score below the copy floor and never reach
//                         clusterAppPairs. Cluster by SHAPE instead: the body tree
//                         with literal values collapsed. Same shape modulo
//                         constants = the same one-liner repeated. Singletons
//                         (no shape twin) are kept and flagged `singleton: true`
//                         — they are trash on their own and must stay visible.
// ---------------------------------------------------------------------------

const { isTrash, TRASH_THRESHOLD, SUSPICIOUS_THRESHOLD } = require("../decision-maker.js");
const { pascalWords } = require("../normalize/words.js");

// A shape cluster of 2+ is a group of mutual one-liners; a size-1 cluster is
// a SINGLETON — still trash on its own (a valueless one-liner is worth
// inlining even without a twin), but flagged so the report can tell the two
// apart. Dropping singletons made real trash invisible (isAmended and its
// siblings never reached the report).
const MIN_TRASH_CLUSTER = 1;

const shapeKey = (tree) => {
	const collapse = (node) => {
		if (!node) return null;
		const label = node.kind === "lit" ? "lit" : node.label;
		return { kind: node.kind, label, children: (node.children || []).map(collapse).filter(Boolean) };
	};
	return JSON.stringify(collapse(tree));
};

const collectTrashClusters = (candidates) => {
	const byShape = new Map(); // shapeKey -> [members]
	for (const c of candidates || []) {
		if (!isTrash(c)) continue;
		const key = shapeKey(c.bodyTree);
		if (!byShape.has(key)) byShape.set(key, []);
		byShape.get(key).push(c);
	}
	const clusters = [];
	for (const members of byShape.values()) {
		if (members.length < MIN_TRASH_CLUSTER) continue;
		clusters.push({ name: trashClusterName(members), members, confidence: 1, singleton: members.length === 1 });
	}
	return clusters;
};

// A cluster heading must distinguish the group. `members[0].name` (and the
// suggestName common-word extraction) both collapse `isVitalsSetBlock` +
// `isVitalsTrendBlock` into "Is" — two clusters then share a heading. The
// words that DISTINGGUISH the members (present in some, not all) carry the
// meaning: set/trend, annotated/removed. Nothing distinguishes → first name.
const trashClusterName = (members) => {
	const list = members || [];
	if (list.length === 1) return list[0].name || "SharedUtil";
	const counts = new Map();
	const order = [];
	for (const m of list) {
		for (const w of pascalWords(m.name)) {
			const k = w.toLowerCase();
			if (!counts.has(k)) {
				counts.set(k, 0);
				order.push(k);
			}
			counts.set(k, counts.get(k) + 1);
		}
	}
	const distinguishing = order.filter((k) => counts.get(k) > 0 && counts.get(k) < list.length);
	if (distinguishing.length === 0) return list[0].name || "SharedUtil";
	return distinguishing.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join("");
};

// A cluster is trash only when EVERY member carries no value: one member with
// real logic keeps the group a legitimate "worth moving" candidate.
const splitTrashClusters = (clusters) => {
	const keep = [];
	const trash = [];
	for (const cluster of clusters || []) {
		const members = cluster.members || [];
		if (members.length > 0 && members.every((m) => isTrash(m))) trash.push(cluster);
		else keep.push(cluster);
	}
	return { keep, trash };
};

module.exports = {
	splitTrashClusters,
	collectTrashClusters,
	trashClusterName,
	shapeKey,
	MIN_TRASH_CLUSTER,
	TRASH_THRESHOLD,
	SUSPICIOUS_THRESHOLD,
};
