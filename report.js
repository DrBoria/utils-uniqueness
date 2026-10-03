"use strict";

const path = require("node:path");

const { pipe, map, join, reduce } = require("remeda");

const renderDuplicateReport = ({ clusters, repoRoot, roots }) => {
	const lines = [];
	lines.push("# Duplicate utility functions");
	lines.push("");
	const rootsLabel = pipe(roots, map((r) => "`" + r + "`"), join(", "));
	lines.push(`Scanned ${rootsLabel}. Found ${clusters.length} duplicate cluster(s).`);
	lines.push("");

	const byTier = pipe(
		clusters,
		reduce((acc, c) => {
			(acc[c.tier] || acc.jscpd).push(c);
			return acc;
		}, { signature: [], body: [], jscpd: [], fragment: [] }),
	);

	const rootSlash = repoRoot ? repoRoot.split("\\").join("/") : "";
	const rel = (p) => {
		const n = p.split("\\").join("/");
		return rootSlash && n.startsWith(rootSlash) ? n.slice(rootSlash.length + 1) : n;
	};

	const sig = (r) => `(${(r.params || []).join(", ")}) → ${r.returns || "?"}`;

	const section = (title, list, why) => {
		if (list.length === 0) return;
		lines.push(`## ${title} (${list.length})`);
		lines.push("");
		lines.push(why);
		lines.push("");
		for (const c of list) {
			const canonLoc = `${rel(c.canonical.path)}:${c.canonical.line}`;
			lines.push(`### \`${c.canonical.name}\` — \`${canonLoc}\``);
			lines.push("");
			lines.push(`canonical: \`${sig(c.canonical)}\``);
			lines.push("");
			lines.push("| Duplicate | Location | Signature |");
			lines.push("| --- | --- | --- |");
			for (const m of c.members) {
				if (m.path === c.canonical.path && m.line === c.canonical.line) continue;
				lines.push(`| ${m.name} | \`${rel(m.path)}:${m.line}\` | \`${sig(m)}\` |`);
			}
			lines.push("");
		}
	};

	section("Signature duplicates", byTier.signature, "identical normalized signature");
	section("Body duplicates", byTier.body, "near-identical body (Jaccard ≥ threshold)");
	section("Whole-function clones", byTier.jscpd, "token-level clone covering most of both functions (name-agnostic)");
	section("Partial duplicates (fragments)", byTier.fragment, "a substantial shared chunk inside two larger functions — extract into a common helper");

	return lines.join("\n");
};

module.exports = { renderDuplicateReport };
