"use strict";

/**
 * scanner/load-config.js
 *
 * Load the rule options from the consumer's config when the scanner is run
 * without --roots. Walks up from the start directory looking for:
 *   1. md-code-utils-uniqueness.config.js (standalone, preferred)
 *   2. eslint.config.js / eslint.config.mjs (flat config — find the rule)
 *   3. .eslintrc.js / .eslintrc.cjs / .eslintrc.json (legacy)
 */

const fs = require("node:fs");
const path = require("node:path");

const RULE_ID = "utils-uniqueness";

/**
 * @param {string} startDir
 * @returns {Promise<{options: object, source: string}|null>}
 */
async function loadRuleOptions(startDir) {
	let dir = startDir;
	for (;;) {
		const found = tryLoadIn(dir);
		if (found) return found;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function tryLoadIn(dir) {
	const standalone = path.join(dir, "md-code-utils-uniqueness.config.js");
	if (fs.existsSync(standalone)) {
		const mod = require(standalone);
		const opts = mod && mod.options !== undefined ? mod.options : mod;
		return { options: opts || {}, source: standalone };
	}

	for (const name of ["eslint.config.js", "eslint.config.mjs"]) {
		const p = path.join(dir, name);
		if (!fs.existsSync(p)) continue;
		try {
			const cfg = require(p);
			const list = Array.isArray(cfg) ? cfg : cfg && typeof cfg === "function" ? cfg({}) : [cfg];
			for (const entry of list || []) {
				if (!entry || typeof entry !== "object") continue;
				const rules = entry.rules || {};
				for (const key of Object.keys(rules)) {
					if (key === RULE_ID || key.endsWith(`/${RULE_ID}`)) {
						const val = rules[key];
						const options = Array.isArray(val) ? val[1] : undefined;
						return { options: options || {}, source: p };
					}
				}
			}
		} catch {
			// unparseable config — keep walking up
		}
	}

	for (const name of [".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json"]) {
		const p = path.join(dir, name);
		if (!fs.existsSync(p)) continue;
		try {
			const cfg = require(p);
			const rules = (cfg && cfg.rules) || {};
			for (const key of Object.keys(rules)) {
				if (key === RULE_ID || key.endsWith(`/${RULE_ID}`)) {
					const val = rules[key];
					const options = Array.isArray(val) ? val[0] : undefined;
					return { options: options || {}, source: p };
				}
			}
		} catch {
			// keep walking up
		}
	}

	return null;
}

module.exports = { loadRuleOptions };
