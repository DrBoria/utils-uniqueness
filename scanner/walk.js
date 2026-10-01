"use strict";

/**
 * scanner/walk.js
 *
 * Directory walking for the catalog scanner: yields every .ts/.tsx/.jsx
 * file under a root, skipping node_modules, dist, build, and dotfiles.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Walk a directory tree, yielding absolute paths of .ts/.tsx/.jsx files.
 *
 * @param {string} dir absolute directory
 * @returns {Generator<string>}
 */
function* walk(dir) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return; // unreadable directory — skip
	}
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(full);
		} else if (/\.(tsx?|jsx)$/.test(entry.name)) {
			yield full;
		}
	}
}

module.exports = { walk };
