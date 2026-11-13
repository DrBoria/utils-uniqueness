"use strict";

// Small number/word formatters shared by every surface that prints a verdict.
//
// They live in the report vocabulary because they only ever produce TEXT: the
// engine decides ("0.8666…"), the report speaks ("0.87", "87%", "yes").

// Two decimals — the precision every threshold is set at, so a score and the
// floor it was compared against can be read side by side.
const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : String(n));

// A weight or a contribution reads as a share of the verdict, not a fraction.
const pct = (n) => `${Math.round((Number.isFinite(n) ? n : 0) * 100)}%`;

// Evidence values are booleans, lists and small numbers. Printed raw, `true`
// and a bare array confuse more than they explain.
const showValue = (value) => {
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
	if (typeof value === "number") return Number.isInteger(value) ? String(value) : num(value);
	return String(value);
};

module.exports = { num, pct, showValue };
