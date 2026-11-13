import { theme } from "../theme";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { Badge, Panel, PanelHead, Subtle, Title, SearchBox, Empty } from "../components/ui";
import { SignalPills } from "../components/DecisionPanel";
import { buildHref } from "../utils/router";
import { KIND_LIST } from "../../../../constants";
import { kindOf, SIGNALS } from "../../../errorTypes/vocabulary/labels";
import { conf, loc } from "../utils/format";

// Every finding, flat — the one screen where the reader narrows 3 000 rows down
// to the handful worth opening.
//
// Three independent dials, because "show me the duplicates" is not the question
// people actually ask:
//
//   KIND     what the run concluded (duplicate / similar / partial / …);
//   SIGNAL   how strongly a given comparison group agreed — "AST ≥ 0.9" is
//            "the same expression, whatever the names", which is what a renamed
//            copy looks like and a shape coincidence does not;
//   TEXT     name, path or a word from the sentence.
//
// Plus an order, so the best evidence is the first thing on screen.

const Table = styled.div`
	overflow-x: auto;
`;

const Grid = styled.div`
	display: grid;
	grid-template-columns: 132px minmax(140px, 1fr) minmax(0, 1.3fr) 84px minmax(150px, 0.9fr) 92px;
	gap: 8px;
	align-items: baseline;
	padding: 7px 4px;
	border-bottom: 1px dashed ${(p) => p.theme.color.border};
	font-size: 12.5px;
	min-width: 920px;
`;

const Head = styled(Grid)`
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.6px;
	color: ${(p) => p.theme.color.textFaint};
	border-bottom: 1px solid ${(p) => p.theme.color.border};
	position: sticky;
	top: 0;
	background: ${(p) => p.theme.color.panel};
	z-index: 1;
`;

const Cell = styled.div`
	min-width: 0;
	overflow-wrap: anywhere;
`;

const Toolbar = styled.div`
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 10px 0 4px;
`;

const Row = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
`;

const Chip = styled.button`
	font-size: 12px;
	padding: 3px 9px;
	border-radius: 999px;
	cursor: pointer;
	color: ${(p) => (p.$active ? p.theme.color.text : p.theme.color.textDim)};
	background: ${(p) => (p.$active ? `${p.$color ?? p.theme.color.accent}33` : "transparent")};
	border: 1px solid ${(p) => (p.$active ? p.$color ?? p.theme.color.accent : p.theme.color.border)};
	&:hover { color: ${(p) => p.theme.color.text}; }
`;

const Label = styled.span`
	font-size: 11.5px;
	color: ${(p) => p.theme.color.textDim};
	min-width: 74px;
`;

const Slider = styled.input`
	width: 104px;
	accent-color: ${(p) => p.$color};
`;

const Value = styled.span`
	font-family: ${(p) => p.theme.font.mono};
	font-size: 11.5px;
	color: ${(p) => (p.$on ? p.$color : p.theme.color.textFaint)};
	min-width: 30px;
`;

const Select = styled.select`
	background: ${(p) => p.theme.color.panelAlt};
	color: ${(p) => p.theme.color.text};
	border: 1px solid ${(p) => p.theme.color.border};
	border-radius: ${(p) => p.theme.radius.sm};
	font-size: 12px;
	padding: 3px 6px;
`;

const Reset = styled.button`
	font-size: 12px;
	padding: 3px 10px;
	border-radius: 999px;
	cursor: pointer;
	color: ${(p) => p.theme.color.textDim};
	background: transparent;
	border: 1px dashed ${(p) => p.theme.color.border};
`;

const SORTS = [
	["confidence-desc", "confidence ↓"],
	["confidence-asc", "confidence ↑"],
	["name", "local name A→Z"],
	["path", "path A→Z"],
	["kind", "kind"],
];

const scoreOf = (finding, key) => finding.decision?.signals?.[key]?.score ?? 0;

export const FindingsScreen = ({ data }) => {
	const [kind, setKind] = useState("all");
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState("confidence-desc");
	// One threshold per comparison group: 0 means "do not filter on this group".
	const [floors, setFloors] = useState(() => Object.fromEntries(SIGNALS.map((s) => [s.key, 0])));

	const rows = useMemo(() => {
		const filtered = data.findings.filter((finding) => {
			if (kind !== "all" && finding.kind !== kind) return false;
			for (const signal of SIGNALS) {
				const floor = floors[signal.key] ?? 0;
				if (floor > 0 && scoreOf(finding, signal.key) < floor) return false;
			}
			if (!query) return true;
			const haystack = `${finding.left?.name ?? ""} ${finding.left?.path ?? ""} ${finding.right?.name ?? ""} ${finding.right?.path ?? ""} ${finding.message}`.toLowerCase();

			return haystack.includes(query.toLowerCase());
		});

		const byConfidence = (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0);
		const sorted = [...filtered];
		if (sort === "confidence-desc") sorted.sort(byConfidence);
		else if (sort === "confidence-asc") sorted.sort((a, b) => byConfidence(b, a));
		else if (sort === "name") sorted.sort((a, b) => String(a.left?.name ?? "").localeCompare(String(b.left?.name ?? "")));
		else if (sort === "path") sorted.sort((a, b) => String(a.left?.path ?? "").localeCompare(String(b.left?.path ?? "")) || byConfidence(a, b));
		else if (sort === "kind") sorted.sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || byConfidence(a, b));

		return sorted;
	}, [data.findings, kind, query, sort, floors]);

	const anyFloor = SIGNALS.some((s) => (floors[s.key] ?? 0) > 0);
	const reset = () => {
		setKind("all");
		setQuery("");
		setSort("confidence-desc");
		setFloors(Object.fromEntries(SIGNALS.map((s) => [s.key, 0])));
	};

	return (
		<Panel>
			<PanelHead>
				<Title>Findings ({rows.length})</Title>
				<Subtle>
					of {data.findings.length} · click a row for the diff and the full decision
				</Subtle>
			</PanelHead>
			<SearchBox value={query} onChange={setQuery} placeholder="Filter by name, path or words…" />
			<Toolbar>
				<Row>
					<Label>kind</Label>
					<Chip $active={kind === "all"} onClick={() => setKind("all")}>
						all
					</Chip>
					{KIND_LIST.map((value) => {
						const count = data.byKind.find((k) => k.value === value)?.count ?? 0;
						if (count === 0 && kind !== value) return null;

						return (
							<Chip key={value} $active={kind === value} $color={kindOf(value).color} onClick={() => setKind(value)}>
								{value} ({count})
							</Chip>
						);
					})}
				</Row>
				<Row>
					<Label>group ≥</Label>
					{SIGNALS.map((signal) => (
						<React.Fragment key={signal.key}>
							<label htmlFor={`floor-${signal.key}`} style={{ display: "flex", alignItems: "center", gap: 5 }}>
								<Label style={{ minWidth: 0, color: signal.color }}>{signal.short ?? signal.label}</Label>
								<Slider
									id={`floor-${signal.key}`}
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={floors[signal.key] ?? 0}
									$color={signal.color}
									onChange={(event) => setFloors((prev) => ({ ...prev, [signal.key]: Number(event.target.value) }))}
								/>
								<Value $on={(floors[signal.key] ?? 0) > 0} $color={signal.color}>
									{(floors[signal.key] ?? 0).toFixed(2)}
								</Value>
							</label>
						</React.Fragment>
					))}
				</Row>
				<Row>
					<Label>sort</Label>
					<Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="sort findings">
						{SORTS.map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
					{(kind !== "all" || query || anyFloor || sort !== "confidence-desc") ? <Reset onClick={reset}>reset filters</Reset> : null}
				</Row>
			</Toolbar>
			<Table>
				<Head>
					<Cell>Kind</Cell>
					<Cell>Local util</Cell>
					<Cell>Canonical / peer</Cell>
					<Cell>Confidence</Cell>
					<Cell>Signals</Cell>
					<Cell>Diff</Cell>
				</Head>
				{rows.length === 0 ? (
					<Empty>Nothing matches the filter.</Empty>
				) : (
					rows.map((finding) => (
						<Grid key={finding.id}>
							<Cell>
								<Badge color={finding.color} nowrap>
									{finding.label}
								</Badge>
							</Cell>
							<Cell>
								<strong>{finding.left?.name ?? "—"}</strong>
								<div style={{ color: theme.color.textFaint, fontFamily: theme.font.mono, fontSize: 11.5 }}>{loc(finding.left)}</div>
							</Cell>
							<Cell>
								{finding.right?.name ?? (finding.members ? `${finding.members.length} member(s)` : "—")}
								<div style={{ color: theme.color.textFaint, fontFamily: theme.font.mono, fontSize: 11.5 }}>{finding.right ? loc(finding.right) : ""}</div>
							</Cell>
							<Cell>
								<strong>{conf(finding.confidence)}</strong>
							</Cell>
							<Cell>
								<div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
									<SignalPills decision={finding.decision} />
								</div>
							</Cell>
							<Cell>
								{finding.hasPair ? (
									<a href={buildHref("pair", { id: finding.id })}>open diff →</a>
								) : (
									<span style={{ color: theme.color.textFaint }}>—</span>
								)}
							</Cell>
						</Grid>
					))
				)}
			</Table>
		</Panel>
	);
};
