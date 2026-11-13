"use strict";

import React from "react";
import styled from "styled-components";
import { textOf } from "./model";
import { pairTheme } from "./theme";

// ── DETAIL ────────────────────────────────────────────────────────────────
//
// Two things the reader can open: a run (what exactly is on both sides of it)
// and the console block for the whole pair — every matcher together, whatever
// tab is open. Both come from data; nothing is recomputed in the browser.

const Panel = styled.div`
	border-top: 1px solid ${pairTheme.chrome.border};
	background: ${pairTheme.chrome.panelAlt};
	font-family: ${pairTheme.font.mono};
	font-size: 11.5px;
	max-height: 30vh;
	overflow: auto;
`;

const Head = styled.div`
	display: flex;
	gap: 10px;
	align-items: baseline;
	padding: 5px 10px;
	border-bottom: 1px solid ${pairTheme.chrome.border};
	background: ${pairTheme.chrome.panel};
	font-family: ${pairTheme.font.sans};
	font-size: 11.5px;
	color: ${pairTheme.chrome.dim};
`;

const Line = styled.div`
	padding: 0 10px;
	white-space: pre-wrap;
	line-height: 1.5;
	color: ${(p) => (p.$dim ? pairTheme.chrome.faint : pairTheme.chrome.text)};
`;

// The terminal text, verbatim: same characters, same indentation.
const Pre = styled.pre`
	margin: 0;
	padding: 6px 10px;
	font-family: ${pairTheme.font.mono};
	font-size: 11.5px;
	line-height: 1.5;
	white-space: pre-wrap;
	color: ${pairTheme.chrome.text};
`;

// ── THE CONSOLE BLOCK ─────────────────────────────────────────────────────
//
// `pair.cli` IS the text `cli-report` prints for this finding — id, names,
// locations, verdict, reasons, every matcher's own lines, the fix. The page
// renders that string and nothing else: no rerun, no reassembly, no summary.
const runRows = (rows, run) =>
	rows.slice(run.from, run.to + 1).map((row, index) => {
		const left = textOf(row.left);
		const right = textOf(row.right);

		return (
			<Line key={index} $dim={left !== right}>
				{`${String(row.left.no).padStart(4)} ${left}`}
				{left === right ? "" : `\n${String(row.right.no).padStart(4)} ${right}`}
			</Line>
		);
	});

export const Detail = ({ run, rows, pair }) => {
	if (run) {
		const first = rows[run.from];
		const last = rows[run.to];

		return (
			<Panel>
				<Head>
					<strong style={{ color: pairTheme.chrome.text }}>{run.label}</strong>
					<span>
						left {first.left.no}–{last.left.no} ↔ right {first.right.no}–{last.right.no}
					</span>
					<span style={{ marginLeft: "auto" }}>{run.to - run.from + 1} row(s)</span>
				</Head>
				{runRows(rows, run)}
			</Panel>
		);
	}
	if (!pair?.cli) return null;

	return (
		<Panel>
			<Head>
				<strong style={{ color: pairTheme.chrome.text }}>CLI Output</strong>
				<span>what the terminal prints for this function</span>
			</Head>
			<Pre>{pair.cli}</Pre>
		</Panel>
	);
};

export default Detail;
