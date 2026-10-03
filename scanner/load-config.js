"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RULE_ID = "jsts-utils-uniqueness";

const tryLoadIn = (dir) => {
	const standalone = path.join(dir, "md-code-jsts-utils-uniqueness.config.js");
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
		}
	}

	return null;
};

const loadRuleOptions = async (startDir) => {
	let dir = startDir;
	for (;;) {
		const found = tryLoadIn(dir);
		if (found) return found;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
};

module.exports = { loadRuleOptions };
