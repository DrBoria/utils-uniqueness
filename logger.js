"use strict";

const fs = require("node:fs");
const path = require("node:path");

const state = {
	enabled: false,
	stream: null,
	file: null,
};

const enabled = () => state.enabled;

const enable = (file) => {
	if (!file) return;
	const abs = path.resolve(process.cwd(), file);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	if (state.stream) state.stream.end();
	state.stream = fs.createWriteStream(abs, { flags: "w" });
	state.file = abs;
	state.enabled = true;
};

const disable = () => {
	if (state.stream) state.stream.end();
	state.stream = null;
	state.file = null;
	state.enabled = false;
};

const write = (entry) => {
	if (!state.enabled || !state.stream) return;
	state.stream.write(`${JSON.stringify(entry)}\n`);
};

const stage = (name, data) => {
	write({ ts: Date.now(), stage: name, ...data });
};

const flush = () => {
	if (state.stream) state.stream.end();
};

module.exports = { enable, disable, enabled, stage, write, flush };
