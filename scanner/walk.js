"use strict";

const fs = require("node:fs");
const path = require("node:path");

const walk = (dir) => {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out = [];
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(full));
		} else if (/\.(tsx?|jsx)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
};

module.exports = { walk };
