"use strict";

// Public entry for the interactive overview (`--overview`).
//
//   const { collectOverviewData, writeOverview } = require("./report/user-report");
//   const written = writeOverview(collectOverviewData({ comp, repoRoot, config }), "reports/utils-overview.html");
//
// The payload is plain JSON; the presentation is the React app in ./src,
// compiled on demand by ./build/bundle.js and inlined by ./html/shell.js.

const path = require("node:path");
const fs = require("node:fs");

const { collectOverviewData } = require("./data/collect");
const { renderHtml } = require("./html/shell");

const renderOverview = (data) => renderHtml(data);

// Write the overview and return the path plus its size, so the CLI can say one
// line about a file the reader is about to open.
const writeOverview = (data, outPath) => {
	const abs = path.resolve(outPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, renderOverview(data), "utf8");

	return { path: abs, bytes: fs.statSync(abs).size };
};

module.exports = { collectOverviewData, renderOverview, writeOverview };
