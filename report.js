"use strict";

const path = require("node:path");

function renderDuplicateReport({ clusters, repoRoot, roots }) {
	const lines = [];
	lines.push("# Duplicate utility functions");
	lines.push("");
	lines.push(`Scanned ${roots.map((r) => `\`${r}\``).join(", ")}. Found ${clusters.length} duplicate cluster(s).`);
	lines.push("");

	const byTier = { signature: [], body: [], jscpd: [], fragment: [] };
	for (const c of clusters) {
		(byTier[c.tier] || byTier.jscpd).push(c);
	}

	const rel = (p) => {
		const n = p.split("\\").join("/");
		return repoRoot && n.startsWith(repoRoot.split("\\").join("/")) ? n.slice(repoRoot.split("\\").join("/").length + 1) : n;
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
}

module.exports = { renderDuplicateReport };
