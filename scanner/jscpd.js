"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const { map } = require("remeda");

const jscpdCommand = () => {
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
	}
	return { cmd: isWin ? "jscpd.cmd" : "jscpd", prefix: [] };
};

const readSlice = (root, name, start, end) => {
	if (!name || !start || !end || end < start) return [];
	const normalized = (name || "").replace(/\\/g, "/");
	const file = path.isAbsolute(normalized) ? normalized : path.join(root, normalized);
	try {
		return fs.readFileSync(file, "utf8").split("\n").slice(start - 1, end);
	} catch {
		return [];
	}
};

const runJscpd = (opts) => {
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
			}
			try {
				fs.rmSync(outDir, { recursive: true, force: true });
			} catch {
			}
			if (err && !report) {
				reject(new Error(`jscpd failed: ${stderr || err.message}`));
				return;
			}
			const dups = (report && report.duplicates) || [];
			resolve(
				map(dups, (d) => ({
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
				})),
			);
		});
	});
};

const toPairRefs = (clones, root) => {
	const resolve = (name) => {
		const normalized = (name || "").replace(/\\/g, "/");
		return path.isAbsolute(normalized) ? normalized : path.join(root, normalized);
	};
	return map(clones || [], (c) => ({
		a: { path: resolve(c.firstFile), line: c.firstStart, endLine: c.firstEnd, lines: c.firstLines, tokens: c.tokens },
		b: { path: resolve(c.secondFile), line: c.secondStart, endLine: c.secondEnd, lines: c.secondLines, tokens: c.tokens },
	}));
};

module.exports = { runJscpd, toPairRefs, jscpdCommand };
