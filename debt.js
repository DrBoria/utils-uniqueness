"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findRepoRoot } = require("./config");

const loadLedger = (filePath) => {
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return raw;
		}
	} catch {
	}
	return {};
};

const applyDebt = (context, ledger, ruleId) => {
	if (!ledger || Object.keys(ledger).length === 0) {
		return context;
	}

	const rel = repoRelative(context);

	const wrapped = Object.create(context);
	Object.defineProperty(wrapped, "report", {
		value: (descriptor) => {
			const key = `${rel}::${ruleId}`;
			if (Object.prototype.hasOwnProperty.call(ledger, key)) {
				return;
			}
			context.report(descriptor);
		},
	});
	return wrapped;
};

const repoRelative = (context) => {
	const filePath = context.getFilename ? context.getFilename() : context.filename;
	if (!filePath || filePath === "<input>") {
		return "<unknown>";
	}
	const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
	const root = findRepoRoot(path.dirname(abs));
	if (root) return path.relative(root, abs).split(path.sep).join("/");
	return abs.split(path.sep).join("/");
};

module.exports = { applyDebt, loadLedger, repoRelative };
