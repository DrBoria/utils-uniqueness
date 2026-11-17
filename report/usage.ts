"use strict";

// The `--help` text. It lives in the report layer because it is READER output —
// the CLI parses flags, the report explains them.

const USAGE = Object.freeze([
	"Usage: utils-uniqueness [--roots a:b] [--out file] [--registry file] [--repo-root dir] [--check]",
	"  [--report [file.md]] [--overview [file.html]] [--app-roots a:b] [--files a.ts:b.ts]",
	"  [--ignore-dirs a:b] [--include a.ts:b.ts] [--thresholds dup:sim] [--parts] [--propose-utils]",
	"  [--config file] [--log file] [--min-cluster N] [--verbose] [--quiet]",
	"",
	"  --overview [file]  write the interactive HTML page (diffs + decisions). Opt-in:",
	"                     a plain `eslint src` run never writes it. Default reports/utils-overview.html",
	"  --report [file]    write the markdown report. Default reports/utils-duplicates.md",
	"",
	"Rule options (weights, thresholds, parts, include, ignoreDirs, utilsFolder) are read from the",
	"consumer's eslint.config.js (rule md-code/utils-uniqueness) or md-code-utils-uniqueness.config.js;",
	"--config points to a specific file. CLI flags override the config.",
]);

export {  USAGE  };
