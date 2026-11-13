"use strict";

const { KIND, KIND_LIST } = require("../../../constants");

// The report BY FOLDER.
//
// A verdict on `src/app/order/total.ts` is a fact about `src/app/order` first and
// about a file second: the team that owns the folder fixes it. So the findings
// are rolled up into the directory tree they live in — every folder carries the
// count of each kind of finding BELOW it, including its children, so a collapsed
// `src/app` row already says how much work is inside.
//
// Only the LOCAL side of a finding counts here (the canonical util is the
// answer, not the problem) — and a finding that sits in a utils folder counts
// for that folder like any other.



const emptyCounts = () => Object.fromEntries([...KIND_LIST.map((k) => [k, 0]), ["total", 0]]);

const dirOf = (relPath) => {
	const clean = String(relPath ?? "").replace(/\\/g, "/");
	const idx = clean.lastIndexOf("/");

	return idx === -1 ? "." : clean.slice(0, idx) || ".";
};

const makeNode = (dirPath) => ({
	path: dirPath,
	name: dirPath === "." ? "(root)" : dirPath.split("/").pop(),
	depth: dirPath === "." ? 0 : dirPath.split("/").length,
	counts: emptyCounts(),
	childDirs: new Map(),
	children: [],
	findings: [],
});

const ensureNode = (tree, dirPath) => {
	if (!dirPath || dirPath === ".") return tree;
	const parts = dirPath.split("/");
	let node = tree;
	let walked = "";
	for (const part of parts) {
		walked = walked ? `${walked}/${part}` : part;
		if (!node.childDirs.has(walked)) node.childDirs.set(walked, makeNode(walked));
		node = node.childDirs.get(walked);
	}

	return node;
};

const bump = (tree, dirPath, kind) => {
	if (tree.counts[kind] != null) tree.counts[kind] += 1;
	tree.counts.total += 1;
	let walked = "";
	for (const part of String(dirPath).split("/").filter((p) => p && p !== ".")) {
		walked = walked ? `${walked}/${part}` : part;
		const node = ensureNode(tree, walked);
		if (node.counts[kind] != null) node.counts[kind] += 1;
		node.counts.total += 1;
	}
};

const finalize = (node) => ({
	path: node.path,
	name: node.name,
	depth: node.depth,
	counts: node.counts,
	findings: node.findings,
	children: [...node.childDirs.values()].sort((a, b) => a.path.localeCompare(b.path)).map(finalize),
});

const buildFolders = (findings) => {
	const tree = makeNode(".");

	for (const finding of findings) {
		const dirPath = dirOf(finding.left?.path);
		const node = ensureNode(tree, dirPath);
		node.findings.push(finding.id);
		bump(tree, dirPath, finding.kind);
	}

	// A folder with nothing under it is noise in a report about duplicates.
	const prune = (node) => {
		const children = node.children.map(prune).filter(Boolean);

		return { ...node, children, counts: { ...node.counts } };
	};

	const root = finalize(tree);
	const isEmpty = (node) => node.counts.total === 0 && node.children.every(isEmpty);
	const walk = (node) => (isEmpty(node) ? null : { ...node, children: node.children.map(walk).filter(Boolean) });
	const pruned = walk(root);
	void prune;

	return pruned ?? { ...root, children: [] };
};

module.exports = { buildFolders, dirOf, KIND_LIST };
