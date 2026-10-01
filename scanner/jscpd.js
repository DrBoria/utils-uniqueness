"use strict";

/**
 * scanner/jscpd.js
 *
 * Ready-made duplicate source #1: the jscpd CLI. We shell out to `jscpd`
 * with `--reporters json`, read the JSON report, and convert its clone pairs
 * into the {a, b} endpoint refs that matching.js consumes.
 *
 * jscpd is an UNFILTERED source: it reports raw token/AST clones with no
 * notion of "this is a utility function". The matcher then intersects those
 * pairs with the extracted function records, so only pairs where BOTH
 * endpoints are recognized utility functions survive.
 *
 * Why the CLI and not @jscpd/core in-process: the library API requires
 * manual assembly (Tokenizer + MemoryStore + per-file detect) and, in
 * testing, returned 0 clones for known cross-file pairs — the CLI is the
 * supported, complete path.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

/**
 * Locate the jscpd executable. Returns the command to exec plus any leading
 * arguments (needed when the bin is a plain .js file that must be run through
 * node). Prefers the local node_modules/.bin shim (npm .cmd / bun .exe /
 * unix script), then the package's own bin, then `jscpd` on PATH.
 *
 * @returns {{cmd: string, prefix: string[]}}
 */
function jscpdCommand() {
	const isWin = process.platform === "win32";
	for (const name of isWin ? ["jscpd.cmd", "jscpd.exe", "jscpd"] : ["jscpd"]) {
		const localBin = path.join(process.cwd(), "node_modules", ".bin", name);
		if (fs.existsSync(localBin)) return { cmd: localBin, prefix: [] };
	}
	try {
		const pkg = require.resolve("jscpd/package.json");
		const pkgDir = path.dirname(pkg);
		const meta = JSON.parse(fs.readFileSync(pkg, "utf8"));
		const binRel = typeof meta.bin === "string" ? meta.bin : meta.bin && meta.bin.jscpd;
		if (binRel) {
			const binPath = path.join(pkgDir, binRel);
			if (fs.existsSync(binPath)) {
				if (/\.(js|mjs|cjs)$/i.test(binPath)) return { cmd: process.execPath, prefix: [binPath] };
				return { cmd: binPath, prefix: [] };
			}
		}
	} catch {
		// not resolvable from here
	}
	return { cmd: isWin ? "jscpd.cmd" : "jscpd", prefix: [] };
}

/**
 * Read the 1-based inclusive line range [start, end] of a file that lives
 * under `root`. jscpd v5's JSON report does not embed the clone's source
 * lines, so we slice them out of the files ourselves.
 *
 * @param {string} root absolute scan root
 * @param {string} name file name as reported by jscpd (relative to root)
 * @param {number} start 1-based inclusive first line
 * @param {number} end 1-based inclusive last line
 * @returns {string[]} the lines, or [] when unreadable
 */
function readSlice(root, name, start, end) {
	if (!name || !start || !end || end < start) return [];
	const normalized = (name || "").replace(/\\/g, "/");
	const file = path.isAbsolute(normalized) ? normalized : path.join(root, normalized);
	try {
		return fs.readFileSync(file, "utf8").split("\n").slice(start - 1, end);
	} catch {
		return [];
	}
}

/**
 * Run jscpd over a directory and return its raw clone pairs.
 *
 * @param {object} opts
 * @param {string} opts.root absolute directory to scan
 * @param {number} [opts.minTokens] jscpd --min-tokens
 * @param {number} [opts.similarity] jscpd --similarity (0..1)
 * @param {number} [opts.minLines] jscpd --min-lines
 * @param {string} [opts.mode] jscpd --mode (mild|weak|strict)
 * @param {number} [opts.timeoutMs] hard wall-clock cap for the subprocess
 * @returns {Promise<Array<object>>} raw jscpd clones
 */
function runJscpd(opts) {
	const { root, minTokens = 20, similarity = 0.7, minLines = 0, mode = "strict", timeoutMs = 120000 } = opts;
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-"));
	const args = [
		"--min-tokens",
		String(minTokens),
		"--similarity",
		String(similarity),
		"--reporters",
		"json",
		"--output",
		outDir,
		"--silent",
	];
	if (minLines > 0) args.push("--min-lines", String(minLines));
	if (mode) args.push("--mode", String(mode));
	args.push(root);

	const { cmd, prefix } = jscpdCommand();
	const useShell = process.platform === "win32" && /\.cmd$|\.bat$|\.exe$/i.test(cmd);

	return new Promise((resolve, reject) => {
		execFile(cmd, [...prefix, ...args], { maxBuffer: 64 * 1024 * 1024, shell: useShell, timeout: timeoutMs, killSignal: process.platform === "win32" ? "SIGTERM" : "SIGKILL" }, (err, _stdout, stderr) => {
			let report = null;
			try {
				const reportPath = path.join(outDir, "jscpd-report.json");
				if (fs.existsSync(reportPath)) {
					report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
				}
			} catch {
				// unreadable report — treat as no clones
			}
			try {
				fs.rmSync(outDir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
			if (err && !report) {
				reject(new Error(`jscpd failed: ${stderr || err.message}`));
				return;
			}
			const dups = (report && report.duplicates) || [];
			resolve(
				dups.map((d) => ({
					firstFile: d.firstFile && d.firstFile.name,
					firstStart: d.firstFile && d.firstFile.start,
					firstEnd: d.firstFile && d.firstFile.end,
					firstLines: readSlice(root, d.firstFile && d.firstFile.name, d.firstFile && d.firstFile.start, d.firstFile && d.firstFile.end),
					secondFile: d.secondFile && d.secondFile.name,
					secondStart: d.secondFile && d.secondFile.start,
					secondEnd: d.secondFile && d.secondFile.end,
					secondLines: readSlice(root, d.secondFile && d.secondFile.name, d.secondFile && d.secondFile.start, d.secondFile && d.secondFile.end),
					tokens: d.tokens,
					kind: d.kind,
				}))
			);
		});
	});
}

/**
 * Convert jscpd clone pairs into {a, b} endpoint refs for matching.js.
 * jscpd reports file names relative to the scan root and uses 1-based start
 * lines; each endpoint is {path, line} and the matcher resolves it to the
 * record whose function range contains the line.
 *
 * @param {Array<object>} clones raw jscpd clones
 * @param {string} root absolute directory that was passed to jscpd
 * @returns {Array<{a:{path:string,line:number}, b:{path:string,line:number}}>}
 */
function toPairRefs(clones, root) {
	const resolve = (name) => {
		const normalized = (name || "").replace(/\\/g, "/");
		return path.isAbsolute(normalized) ? normalized : path.join(root, normalized);
	};
	return (clones || []).map((c) => ({
		a: { path: resolve(c.firstFile), line: c.firstStart, endLine: c.firstEnd, lines: c.firstLines, tokens: c.tokens },
		b: { path: resolve(c.secondFile), line: c.secondStart, endLine: c.secondEnd, lines: c.secondLines, tokens: c.tokens },
	}));
}

module.exports = { runJscpd, toPairRefs, jscpdCommand };
