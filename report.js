"use strict";

const { trashScore } = require("./decision-maker");

const TIERS = ["duplicate", "similar"];

const TIER_LABEL = {
	duplicate: "Duplicate (confidence ≥ threshold)",
	similar: "Similar (below duplicate threshold)",
};

const renderHeader = (comp) => {
	const lines = [];
	lines.push("# Utility duplicates (function-level funnel)");
	lines.push("");
	lines.push(`Scanned ${comp.files} app file(s), ${comp.appCount} app util(s) against ${comp.canonCount} canonical util(s).`);
	// The Duplicate / Similar sections only render APP-layer matches (layer
	// matches go to the "Inside <folder>" sections), so the header must count
	// the same app-layer subset — otherwise it reports a total the sections
	// never show (real run: header "11 duplicate" vs section "(9)").
	const folders = comp.layerFolders || [];
	const inLayer = (p) => folders.some((d) => p.startsWith(d));
	const appMatches = comp.matches.filter((m) => !inLayer(m.app.path));
	const dupCount = appMatches.filter((m) => m.decision.tier === "duplicate").length;
	const simCount = appMatches.filter((m) => m.decision.tier === "similar").length;
	const missingCount = (comp.missingClusters || []).reduce((n, c) => n + c.matches.length, 0);
	const appClusterCount = (comp.appClusters || []).reduce((n, c) => n + c.members.length, 0);
	const trashCount = (comp.trashClusters || []).reduce((n, c) => n + c.members.length, 0);
	lines.push(`Found ${dupCount} duplicate util(s) and ${simCount} similar util(s)${comp.dropped && comp.dropped.length > 0 ? ` (after filtering out ${comp.dropped.length} match(es))` : ""}${missingCount > 0 ? `, plus ${missingCount} util(s) grouped under ${(comp.missingClusters || []).length} potentially missing util(s)` : ""}${appClusterCount > 0 ? `, plus ${appClusterCount} util(s) in ${(comp.appClusters || []).length} cross-file copy group(s) worth moving to utils` : ""}${trashCount > 0 ? `, plus ${trashCount} valueless one-liner(s) flagged as trash (inline at call site)` : ""}.`);
	lines.push("");
	return lines;
};

const renderTrashSection = (clusters) => {
	if (!clusters || clusters.length === 0) return [];
	const lines = [];
	lines.push(`## Trash — inline these (${clusters.length})`);
	lines.push("");
	lines.push("These are mutual one-liners that carry no value as standalone functions — a single comparison of a status-like field against a literal. Do NOT extract them to utils: delete the function and inline the comparison at the call site (e.g. `set.status === \"amended\"`).");
	lines.push("");
	for (const cluster of clusters) {
		// A singleton has no shape twin — it is trash on its own. Mark it so
		// the reader does not expect a sibling in the group.
		lines.push(`### ${cluster.name}${cluster.singleton ? " (singleton)" : ""}`);
		lines.push("");
		lines.push("| Function | Location | Verdict | Inline as |");
		lines.push("| --- | --- | --- | --- |");
		const sorted = [...cluster.members].sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
		for (const m of sorted) {
			const body = m.rawText ? String(m.rawText).replace(/\s+/g, " ").trim() : "";
			const score = Number.isFinite(m.trashScore) ? m.trashScore : trashScore(m);
			lines.push(`| ${m.name} | \`${m.path}:${m.line}\` | **Trash** (score ${score}) — рекомендуется инлайн | \`${body}\` |`);
		}
		lines.push("");
	}
	return lines;
};

const renderAppPairsSection = (clusters) => {
	if (!clusters || clusters.length === 0) return [];
	const lines = [];
	lines.push(`## Worth moving to utils — cross-file copies (${clusters.length})`);
	lines.push("");
	lines.push("These functions are near-identical copies of each other across app files, with no canonical util to point at. The logic is duplicated in the app itself — extract a single shared util and call it from everywhere in the group.");
	lines.push("");
	for (const cluster of clusters) {
		lines.push(`### ${cluster.name}`);
		lines.push("");
		lines.push(`All ${cluster.members.length} functions below are mutual copies (weakest link ${cluster.confidence.toFixed(2)}). A shared \`${cluster.name}\` would replace them all.`);
		lines.push("");
		lines.push("| Function | Location |");
		lines.push("| --- | --- |");
		const sorted = [...cluster.members].sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
		for (const m of sorted) {
			lines.push(`| ${m.name} | \`${m.path}:${m.line}\` |`);
		}
		lines.push("");
	}
	return lines;
};

const renderTierSection = (tier, rows, title = TIER_LABEL[tier]) => {
	const lines = [];
	lines.push(`## ${title} (${rows.length})`);
	lines.push("");
	lines.push("| Local util | Location | Duplicates canonical | Canonical location | Confidence | Why |");
	lines.push("| --- | --- | --- | --- | --- | --- |");
	const sorted = [...rows].sort((a, b) => b.decision.confidence - a.decision.confidence || a.canon.name.localeCompare(b.canon.name));
	for (const m of sorted) {
		lines.push(`| ${m.app.name} | \`${m.app.path}:${m.app.line}\` | ${m.canon.name} | \`${m.canon.path}\` | ${m.decision.confidence.toFixed(2)} | ${m.decision.reason} |`);
	}
	lines.push("");
	return lines;
};

const renderMissingSection = (clusters) => {
	if (!clusters || clusters.length === 0) return [];
	const lines = [];
	lines.push(`## Potentially missing util (${clusters.length})`);
	lines.push("");
	lines.push("Several distinct utils all matched the same canonical. This usually means the codebase is missing a shared util that would unify them — not that any single one is a duplicate. Consider extracting a new shared util for each group below.");
	lines.push("");
	for (const cluster of clusters) {
		lines.push(`### ${cluster.name}`);
		lines.push("");
		lines.push(`All ${cluster.matches.length} utils below matched canonical \`${cluster.canon.name}\` (\`${cluster.canon.path}\`). They are structurally similar to each other but distinct enough that none is a clean duplicate — a shared \`${cluster.name}\` would likely cover them.`);
		lines.push("");
		lines.push("| Local util | Location | Matched canonical | Confidence | Why |");
		lines.push("| --- | --- | --- | --- | --- |");
		for (const m of cluster.matches) {
			lines.push(`| ${m.app.name} | \`${m.app.path}:${m.app.line}\` | ${m.canon.name} | ${m.decision.confidence.toFixed(2)} | ${m.decision.reason} |`);
		}
		lines.push("");
	}
	return lines;
};

const renderPartsSection = (rows, title = "Parts of utils that duplicate a canonical") => {
	if (rows.length === 0) return [];
	const lines = [];
	lines.push(`## ${title} (${rows.length})`);
	lines.push("");
	lines.push("| Part | Location | Replace with | From | Why |");
	lines.push("| --- | --- | --- | --- | --- |");
	const primaryConf = (r) => (r.suggestions && r.suggestions[0] ? r.suggestions[0].confidence : r.confidence) || 0;
	const sorted = [...rows].sort((a, b) => primaryConf(b) - primaryConf(a) || a.path.localeCompare(b.path) || a.line - b.line);
	for (const r of sorted) {
		const s = r.suggestions || [r];
		const primary = s[0];
		const alt = s.length > 1 ? `; alt: \`${s[1].util}\` (${s[1].confidence.toFixed(2)})` : "";
		lines.push(`| ${r.owner} \u203a <${r.tag}> | \`${r.path}:${r.line}-${r.endLine}\` | \`${primary.util}\` (${primary.confidence.toFixed(2)})${alt} | ${primary.path} | ${primary.reason} |`);
	}
	lines.push("");
	return lines;
};

const renderFilteredSection = (dropped) => {
	const lines = [];
	const byFilter = new Map();
	for (const d of dropped) {
		if (!byFilter.has(d.filter)) byFilter.set(d.filter, []);
		byFilter.get(d.filter).push(d);
	}
	for (const [filter, rows] of byFilter) {
		lines.push(`## Filtered out by \`${filter}\` (${rows.length})`);
		lines.push("");
		lines.push("| Local util | Location | Canonical | Why dropped |");
		lines.push("| --- | --- | --- | --- |");
		const sorted = [...rows].sort((a, b) => a.match.canon.name.localeCompare(b.match.canon.name));
		for (const d of sorted) {
			lines.push(`| ${d.match.app.name} | \`${d.match.app.path}:${d.match.app.line}\` | ${d.match.canon.name} | ${d.reason} |`);
		}
		lines.push("");
	}
	return lines;
};

const renderUtilsReport = (comp, verbose) => {
	const lines = [];
	const folders = comp.layerFolders || [];
	const inLayer = (p) => folders.some((d) => p.startsWith(d));
	const appMatches = comp.matches.filter((m) => !inLayer(m.app.path));
	const layerMatches = comp.matches.filter((m) => inLayer(m.app.path));
	const appParts = (comp.parts || []).filter((r) => !inLayer(r.path));
	const layerParts = (comp.parts || []).filter((r) => inLayer(r.path));
	lines.push(...renderHeader(comp));
	for (const tier of TIERS) {
		const rows = appMatches.filter((m) => m.decision.tier === tier);
		if (rows.length === 0) continue;
		lines.push(...renderTierSection(tier, rows));
	}
	const missingClusters = (comp.missingClusters || []).filter((c) => c.matches.every((m) => !inLayer(m.app.path)));
	lines.push(...renderMissingSection(missingClusters));
	lines.push(...renderTrashSection(comp.trashClusters));
	lines.push(...renderAppPairsSection(comp.appClusters));
	const layerIdx = (p) => folders.findIndex((d) => p.startsWith(d));
	const layerName = (d) => d.split("/").filter(Boolean).pop();
	for (let li = 0; li < folders.length; li += 1) {
		const seen = folders.slice(0, li).map(layerName);
		const suffix = seen.length > 0 ? ` (vs ${seen.join(" + ")})` : "";
		for (const tier of TIERS) {
			const rows = layerMatches.filter((m) => layerIdx(m.app.path) === li && m.decision.tier === tier);
			if (rows.length === 0) continue;
			lines.push(...renderTierSection(tier, rows, `Inside ${layerName(folders[li])}: ${TIER_LABEL[tier]}${suffix}`));
		}
	}
	lines.push(...renderPartsSection([...appParts, ...layerParts], "Partial duplicates (parts)"));
	if (verbose && comp.dropped && comp.dropped.length > 0) lines.push(...renderFilteredSection(comp.dropped));
	return lines.join("\n");
};

module.exports = { renderUtilsReport, TIERS, TIER_LABEL };
