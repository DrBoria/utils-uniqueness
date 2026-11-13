"use strict";

import React, { useState } from "react";
import styled from "styled-components";
import { SIGNALS, signalOf } from "../../../../errorTypes/vocabulary/labels";
import { percentOf } from "../../../../../evidence";
import { PairDiff } from "./PairDiff";
import { Detail } from "./Detail";
import { pairTheme } from "./theme";

// ── THE PAIR VIEW ─────────────────────────────────────────────────────────
//
// Composition only. It builds the model once (rows → blocks), splits the rows
// into the two columns, and hands each engine its own material:
//
//   Column   — one side, own scroller, own rows
//   Board    — left column, gutter, right column, painter on top
//   Detail   — the open block, or the selected matcher
//
// Nothing here draws a line of code, a rectangle or a ribbon.

// The gutter is where ribbons and captions live. The chips change its width.
const GUTTERS = { 3: 220, 4: 300, 5: 380 };

// The AST tab has five columns: code, tree, corridor, tree, code. Its subject is
// the tree, so the trees get real width and scroll on their own; the corridor is
// narrow because a node is named by a word or two.
// The trees are context: wide enough to read a label, and the corridor is wide
// because every ribbon that leaves a tree has to be seen on its own.
const AST = { tree: 240, gutter: 340 };

const Frame = styled.div`
	border: 1px solid ${pairTheme.chrome.border};
	border-radius: ${pairTheme.radius.md};
	overflow: hidden;
	background: ${pairTheme.chrome.panelAlt};
`;

const Bar = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	padding: 6px 10px;
	border-bottom: 1px solid ${pairTheme.chrome.border};
	background: ${pairTheme.chrome.panel};
	font-family: ${pairTheme.font.sans};
	font-size: 11.5px;
`;

const Tab = styled.button`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 3px 9px;
	border-radius: 999px;
	border: 1px solid ${(p) => (p.$on ? p.$c : pairTheme.chrome.border)};
	background: ${(p) => (p.$on ? `${p.$c}22` : "transparent")};
	color: ${(p) => (p.$on ? pairTheme.chrome.text : pairTheme.chrome.dim)};
	font: inherit;
	cursor: pointer;
`;

const Dot = styled.span`
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: ${(p) => p.$c};
`;

const Chip = styled.button`
	padding: 0 7px;
	border-radius: 999px;
	border: 1px solid ${(p) => (p.$on ? pairTheme.chrome.borderStrong : pairTheme.chrome.border)};
	background: ${(p) => (p.$on ? pairTheme.chrome.panelAlt : "transparent")};
	color: ${(p) => (p.$on ? pairTheme.chrome.text : pairTheme.chrome.faint)};
	font: inherit;
	font-size: 10.5px;
	cursor: pointer;
`;

const Legend = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	align-items: center;
	padding: 5px 10px;
	border-bottom: 1px solid ${pairTheme.chrome.border};
	background: ${pairTheme.chrome.panel};
	font-family: ${pairTheme.font.sans};
	font-size: 11.5px;
	color: ${pairTheme.chrome.dim};
`;

const Head = styled.div`
	display: grid;
	grid-template-columns: ${(p) => p.$template};
	background: ${pairTheme.chrome.panelAlt};
	border-bottom: 1px solid ${pairTheme.chrome.border};
	font-family: ${pairTheme.font.sans};
	font-size: 11px;
	color: ${pairTheme.chrome.dim};
	& > div { padding: 4px 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const PairView = ({ pair, decision }) => {
	const [mode, setMode] = useState(SIGNALS[0].key);
	const [set, setSet] = useState(5);
	const [expanded, setExpanded] = useState(false);

	if (!pair) return null;

	// The board draws the diff. This view hands it COLUMNS of id-addressed items and
	// CONNECTIONS of ids — it never slices rows, never pairs a row with a row, and
	// never turns a line number into a label.
	const columns = pair.columns ?? [];
	const group = signalOf(mode);
	// The score this tab measured, as the decision maker recorded it.
	const gutter = GUTTERS[set];
	const signal = (decision?.signals ?? []).find((item) => item.key === mode) ?? null;
	const percent = (value) => `${Math.round(value * 100)}%`;
	const signatureNames = mode === "signature" ? pair.analysis?.signature?.names ?? null : null;

	return (
		<Frame>
			<Bar>
				{SIGNALS.map((item) => (
					<Tab key={item.key} $on={item.key === mode} $c={item.color} title={item.what} onClick={() => setMode(item.key)}>
						<Dot $c={item.color} />
						{item.label}
					</Tab>
				))}
				<Chip $on={!expanded} onClick={() => setExpanded(!expanded)} title="show every line, folded or not">
					{expanded ? "show all" : "only blocks"}
				</Chip>
				<span style={{ marginLeft: "auto", color: pairTheme.chrome.faint }}>gutter:</span>
				{[3, 4, 5].map((n) => (
					<Chip key={n} $on={n === set} onClick={() => setSet(n)} title={`${GUTTERS[n]}px`}>
						{n}
					</Chip>
				))}
			</Bar>
			<Legend>
				<span>
					<Dot $c={pairTheme.band.same} /> red = the two lines are character-for-character identical
				</span>
				<span>
					<Dot $c={pairTheme.band.diff} /> amber = the lines correspond, their text differs
				</span>
				<span>no ribbon = one side only, or nothing compared here</span>
				{signatureNames ? (
					<span title="names both sides declare" style={{ color: pairTheme.chrome.text }}>
						names {percent(signatureNames.score)}
						{signatureNames.words.common.length ? ` (${signatureNames.words.common.join(" + ")})` : ""} · {signatureNames.common.length}{" "}
						declared by both
					</span>
				) : null}
				{signal ? (
					<span style={{ marginLeft: "auto", color: pairTheme.chrome.faint }}>
						{group.label} {percentOf(signal.score)}% × {signal.weight.toFixed(2)} = {(signal.score * signal.weight).toFixed(2)}
					</span>
				) : null}
			</Legend>
			<Head $template={columns.length === 2 ? `minmax(0, 1fr) ${gutter}px minmax(0, 1fr)` : undefined}>
				{columns.map((column, index) => (
					<React.Fragment key={column.id}>
						<div>{column.path ?? ""}</div>
						{index < columns.length - 1 ? <div /> : null}
					</React.Fragment>
				))}
			</Head>
				<PairDiff pair={pair} mode={mode} reveal={expanded} corridor={gutter} />
			<Detail pair={pair} />
		</Frame>
	);
};

export default PairView;
