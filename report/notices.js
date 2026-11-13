"use strict";

// Everything the run could NOT read, parse or write. A notice is not a finding
// — a finding is a demand on the code, a notice is a caveat about the analysis
// that produced the findings ("this file was skipped, so the answer is
// partial"). It is collected here and printed by the report, exactly once, at
// the end of the run. No module in the engine calls `console.warn` directly:
// a warning the report never shows is a warning the reader never sees.

const { render } = require("./errorTypes/codes");
const { CODE } = require("../constants");

const NOTICES = [];

const severity = (text) => String(text ?? "").trim();

const notice = (text) => {
	const line = severity(text);
	if (!line) return line;
	NOTICES.push(line);
	return line;
};

// `noticed(fn, message)` — run `fn`, and if it throws, record the message with
// the error's own words appended. Returns `null` on failure so callers keep a
// plain value instead of an exception they would have to swallow silently.
const noticed = (fn, message) => {
	try {
		return fn();
	} catch (err) {
		notice(render(CODE.NoticeDetail, { message, reason: err && err.message ? err.message : String(err) }));
		return null;
	}
};

const takeNotices = () => NOTICES.splice(0, NOTICES.length);

const peekNotices = () => [...NOTICES];

const resetNotices = () => {
	NOTICES.length = 0;
};

module.exports = { notice, noticed, takeNotices, peekNotices, resetNotices };
