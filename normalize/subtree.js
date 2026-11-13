"use strict";

// ── THE SIGNATURE OF A SUBTREE ─────────────────────────────────────────────
//
// `kind + label + children signatures`. Two structurally identical subtrees get
// the same string, which is what "the same expression" means everywhere in the
// package. ONE definition: the subtree multiset (normalize/ast.js) hashes it, and
// anything that needs to compare or paint a returned value reads it here.
//
// It lives in its own module because both `tree.js` and `ast.js` need it, and
// importing one from the other would be a cycle.

const signatureOf = (tree) => {
	if (!tree) return "";
	const kids = (tree.children || []).map(signatureOf).join(",");

	return `${tree.kind}:${tree.label ?? ""}[${kids}]`;
};

module.exports = { signatureOf };
