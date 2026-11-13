import { theme } from "../theme";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { Badge, Panel, PanelHead, Subtle, Title, Empty, Stack, SearchBox } from "../components/ui";
import { Diff } from "../components/pair";
import { buildHref } from "../utils/router";
import { conf, loc, shortPath } from "../utils/format";

// One pair, full size, WITH A WAY OUT.
//
// The first version of this screen showed exactly one finding and nothing else,
// which made "open the next one" a mystery. It is now a list plus a detail: the
// list on the left is every finding that has a diff (filterable), the current
// one is marked, and prev/next are keyboard-ish links at the top. The address
// still carries the id (`#/pair?id=…`), so a finding can be sent to a colleague.

const Layout = styled.div`
	display: grid;
	grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
	gap: ${(p) => p.theme.space(3)};
	align-items: start;
	@media (max-width: 1000px) { grid-template-columns: minmax(0, 1fr); }
`;

const List = styled.div`
	max-height: 70vh;
	overflow: auto;
	margin-top: 8px;
	border-top: 1px solid ${(p) => p.theme.color.border};
`;

const Item = styled.a`
	display: block;
	padding: 5px 8px;
	border-radius: ${(p) => p.theme.radius.sm};
	border-left: 3px solid ${(p) => (p.$active ? p.$color : "transparent")};
	background: ${(p) => (p.$active ? p.theme.color.panelAlt : "transparent")};
	font-size: 12.5px;
	color: ${(p) => (p.$active ? p.theme.color.text : p.theme.color.textDim)};
	&:hover { background: ${(p) => p.theme.color.panelAlt}; text-decoration: none; }
`;

const ItemName = styled.div`
	display: flex;
	align-items: baseline;
	gap: 6px;
	min-width: 0;
`;

const Ellipsis = styled.span`
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`;

const Nav = styled.div`
	display: flex;
	gap: 10px;
	align-items: baseline;
	font-size: 12.5px;
`;

export const PairScreen = ({ data, params }) => {
	const [filter, setFilter] = useState("");
	const findings = data.findings;
	const pairsByFinding = useMemo(() => new Map(data.pairs.map((p) => [p.findingId, p])), [data.pairs]);
	const groupsById = useMemo(() => {
		const map = new Map();
		for (const group of data.groups) for (const id of group.findingIds) map.set(id, group);

		return map;
	}, [data.groups]);

	const ordered = findings.filter((f) => f.hasPair);
	const visible = ordered.filter((f) => !filter || f.id.toLowerCase().includes(filter.toLowerCase()) || (f.left?.name ?? "").includes(filter) || (f.right?.name ?? "").includes(filter));
	const current = findings.find((f) => f.id === params.id) ?? ordered[0] ?? null;
	const index = current ? visible.findIndex((f) => f.id === current.id) : -1;
	const prev = index > 0 ? visible[index - 1] : null;
	const next = index >= 0 && index < visible.length - 1 ? visible[index + 1] : null;

	return (
		<Layout>
			<Panel>
				<PanelHead>
					<Title>Findings with a diff ({ordered.length})</Title>
				</PanelHead>
				<SearchBox value={filter} onChange={setFilter} placeholder="Filter by name or id…" />
				<List>
					{visible.length === 0 ? (
						<Empty>Nothing matches.</Empty>
					) : (
						visible.slice(0, 400).map((finding) => (
							<Item key={finding.id} href={buildHref("pair", { id: finding.id })} $active={current && current.id === finding.id} $color={finding.color}>
								<ItemName>
									<Badge color={finding.color} nowrap>
										{finding.label.slice(0, 4)}
									</Badge>
									<Ellipsis>
										{finding.left?.name ?? "—"} → {finding.right?.name ?? "—"}
									</Ellipsis>
									<span style={{ marginLeft: "auto", opacity: 0.8 }}>{conf(finding.confidence)}</span>
								</ItemName>
								<Subtle>{shortPath(finding.left?.path, 2)}</Subtle>
							</Item>
						))
					)}
				</List>
				{visible.length > 400 ? <Subtle>first 400 of {visible.length} — use the filter</Subtle> : null}
			</Panel>
			<Stack>
				{current ? (
					<>
						<Panel $accent={current.color}>
							<PanelHead>
								<Title>
									{current.left?.name ?? "—"} <Subtle>vs</Subtle> {current.right?.name ?? "—"}
								</Title>
								<Badge color={current.color}>{current.label}</Badge>
								<Badge color={theme.color.accent} nowrap>
									{conf(current.confidence)}
								</Badge>
								<Nav>
									{prev ? <a href={buildHref("pair", { id: prev.id })}>← {prev.left?.name ?? prev.id.slice(0, 12)}</a> : <span style={{ opacity: 0.4 }}>←</span>}
									{next ? <a href={buildHref("pair", { id: next.id })}>{next.left?.name ?? next.id.slice(0, 12)} →</a> : <span style={{ opacity: 0.4 }}>→</span>}
									{groupsById.get(current.id) ? <a href={buildHref("groups", { group: groupsById.get(current.id).id })}>group</a> : null}
								</Nav>
							</PanelHead>
							<div style={{ fontSize: 13, color: theme.color.textDim, marginBottom: 8 }}>{current.message}</div>
							<div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, marginBottom: 8 }}>
								<span>
									local <code>{loc(current.left)}</code>
								</span>
								<span>
									canonical <code>{loc(current.right)}</code>
								</span>
							</div>
							{pairsByFinding.get(current.id) ? (
								<Diff pair={pairsByFinding.get(current.id)} decision={current.decision} signals={data.signals} />
							) : (
								<Diff pair={pairsByFinding.get(current.id)} decision={current.decision} signals={data.signals} />
							)}
						</Panel>
						{current.members?.length ? (
							<Panel>
								<PanelHead>
									<Title>Members ({current.members.length})</Title>
								</PanelHead>
								{current.members.map((member) => (
									<div key={`${member.path}:${member.line}:${member.name}`} style={{ fontSize: 13, padding: "3px 0", borderBottom: `1px dashed ${theme.color.border}` }}>
										<strong>{member.name}</strong> <code style={{ color: theme.color.textDim }}>{loc(member)}</code> <Subtle>{conf(member.confidence)}</Subtle>
									</div>
								))}
							</Panel>
						) : null}
					</>
				) : (
					<Panel>
						<Empty>No findings with a diff.</Empty>
					</Panel>
				)}
			</Stack>
		</Layout>
	);
};
