"use strict";

// The ONE funnel for everything the tool says and everything it fails on.
//
//   say()    — progress / result lines on stdout
//   warn()   — something could not be read; recorded as a notice, echoed once
//   fail()   — the run cannot continue: throws a ReportedError, whose message
//              is ALREADY a sentence for the reader, so the top-level catch
//              prints it and nothing else
//   crash()  — the engine itself broke: keeps the stack, but still frames it
//
// No module outside this one (and `bin/`) touches `console` or `process.exit`.

import * as fs from "node:fs";
import * as path from "node:path";

import { notice } from "./notices";
import { render } from "./errorTypes/codes";
import { CODE, WARN_PREFIX } from "../constants";

class ReportedError extends Error {
	reported: boolean;
	constructor(message) {
		super(message);
		this.name = "ReportedError";
		this.reported = true;
	}
}

let quiet = false;

const setQuiet = (value) => {
	quiet = !!value;
};

const say = (text) => {
	if (quiet) return;
	process.stdout.write(`${text}\n`);
};

const warn = (text) => {
	const line = notice(text);
	if (quiet) return;
	process.stderr.write(`${WARN_PREFIX}${line}\n`);
};

const fail = (message) => {
	throw new ReportedError(String(message));
};

const crash = (error) => {
	const detail = error && error.stack ? error.stack : String(error);

	return render(CODE.Crash, { detail });
};

// Write a text artifact (catalog, markdown report) and say so in one line.
// A path that cannot be written is a crash, not a notice: the caller asked for
// a file and the file is the result.
const writeText = (absPath, text) => {
	fs.mkdirSync(path.dirname(absPath), { recursive: true });
	fs.writeFileSync(absPath, text, "utf8");

	return { path: absPath, bytes: Buffer.byteLength(text, "utf8") };
};

const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

export {  ReportedError, say, warn, fail, crash, writeText, setQuiet, kb  };
