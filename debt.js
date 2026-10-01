"use strict";

/**
 * debt.js
 *
 * Generic debt-ledger mechanism (self-contained copy so this package is
 * npm-installable on its own).
 *
 * Doctrine: a rule is TOTAL. Instance-specific findings go to a
 * machine-generated debt ledger (reports/lint-debt.json), keyed
 * "relpath::ruleId" -> count. The ledger is shrink-only: check mode fails if
 * an entry grows or a new key appears.
 *
 * `applyDebt(context, ledger, ruleId)` returns a wrapped ESLint context whose
 * `report` silently drops findings already recorded in the ledger.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Load a debt ledger JSON file. Missing/invalid file -> empty ledger
 * (strict mode: every finding is reported).
 */
function loadLedger(filePath) {
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return raw;
		}
	} catch {
		// missing or corrupt -> strict
	}
	return {};
}

/**
 * Wrap an ESLint context so that `report` drops findings that are already
 * recorded in the debt ledger.
 *
 * Ledger key: `<repo-relative path>::<ruleId>` (matches gen-lint-debt).
 */
function applyDebt(context, ledger, ruleId) {
	if (!ledger || Object.keys(ledger).length === 0) {
		return context;
	}

	const rel = repoRelative(context);

	const wrapped = Object.create(context);
	Object.defineProperty(wrapped, "report", {
		value: function (descriptor) {
			const key = `${rel}::${ruleId}`;
			if (Object.prototype.hasOwnProperty.call(ledger, key)) {
				return; // known debt — already accounted for
			}
			context.report(descriptor);
		},
	});
	return wrapped;
}

/**
 * Resolve the repo-relative path of the file being linted.
 * Walks up from the file looking for a workspace marker.
 */
function repoRelative(context) {
	const filePath = context.getFilename ? context.getFilename() : context.filename;
	if (!filePath || filePath === "<input>") {
		return "<unknown>";
	}
	const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
	const root = findRepoRoot(path.dirname(abs));
	if (root) return path.relative(root, abs).split(path.sep).join("/");
	return abs.split(path.sep).join("/");
}

/**
 * Walk up from a starting directory to the repo root. Recognizes the common
 * workspace markers: pnpm-workspace.yaml, package.json (with workspaces),
 * bun.lockb / bun.lock, or a .git directory.
 */
function findRepoRoot(startDir) {
	let dir = startDir;
	for (;;) {
		if (
			fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
			fs.existsSync(path.join(dir, "bun.lockb")) ||
			fs.existsSync(path.join(dir, "bun.lock")) ||
			fs.existsSync(path.join(dir, ".git"))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

module.exports = { applyDebt, loadLedger, repoRelative, findRepoRoot };
