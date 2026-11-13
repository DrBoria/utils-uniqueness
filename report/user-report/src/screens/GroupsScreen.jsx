import { theme } from "../theme";
import React, { useState } from "react";
import styled from "styled-components";
import { Badge, Panel, PanelHead, Subtle, Title, SearchBox, Empty, Stack } from "../components/ui";
import { Diff } from "../components/pair";
import { buildHref } from "../utils/router";
import { conf, loc } from "../utils/format";

// Utilities grouped BY SIMILARITY: one group per thing that is being reinvented
// (a canonical util matched by several locals), plus the structural groups the
// funnel produced on its own.
//
// Every group is openable, and inside a group every pair shows the diff WITH the
// decision strip — so "why are these two the same?" is answered on the code, not
// in a panel below it. Each pair also links to its own page and the next/prev
// pair is one click away in the list at the top of the group.

const Layout = styled.div`
	display: grid;
	grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
	gap: ${(p) => p.theme.space(3)};
	align-items: start;
	@media (max-width: 1000px) { grid-template-columns: minmax(0, 1fr); }
`;

const GroupRow = styled.a`
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 7px 10px;
	border-radius: ${(p) => p.theme.radius.sm};
	border: 1px solid ${(p) => (p.$active ? p.theme.color.borderStrong : "transparent")};
	background: ${(p) => (p.$active ? p.theme.color.panelAlt : "transparent")};
	&:hover { background: ${(p) => p.theme.color.panelAlt}; text-decoration: none; }
`;

const GroupTitle = styled.div`
	display: flex;
	align-items: baseline;
	gap: 6px;
	font-size: 13px;
	color: ${(p) => p.theme.color.text};
	min-width: 0;
`;

const MemberRow = styled.a`
	display: flex;
	gap: 8px;
	align-items: baseline;
	padding: 3px 6px;
	font-size: 12.5px;
	color: ${(p) => (p.$active ? p.theme.color.text : p.theme.color.textDim)};
	background: ${(p) => (p.$active ? p.theme.color.panelAlt : "transparent")};
	border-radius: ${(p) => p.theme.radius.sm};
	border-left: 2px solid ${(p) => (p.$active ? p.theme.color.accent : "transparent")};
	&:hover { background: ${(p) => p.theme.color.panelAlt}; text-decoration: none; }
`;

const Ellipsis = styled.span`
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
	flex: 1 1 auto;
`;

export const GroupsScreen = ({ data, params }) => {
	const [filter, setFilter] = useState("");
	const groups = data.groups.filter((g) => !filter || g.name.toLowerCase().includes(filter.toLowerCase()) || (g.canonical?.path ?? "").includes(filter));
	const selected = groups.find((g) => g.id === params.group) ?? groups[0] ?? null;
	const findingsById = new Map(data.findings.map((f) => [f.id, f]));
	const pairsByFinding = new Map(data.pairs.map((p) => [p.findingId, p]));
	const pairs = selected ? selected.findingIds.map((id) => findingsById.get(id)).filter(Boolean) : [];
	const focusId = params.id ?? pairs[0]?.id ?? null;
	const focused = pairs.find((f) => f.id === focusId) ?? pairs[0] ?? null;

	return (
		<Layout>
			<Panel>
				<PanelHead>
					<Title>Groups ({groups.length})</Title>
				</PanelHead>
				<SearchBox value={filter} onChange={setFilter} placeholder="Filter groups…" />
				<div style={{ marginTop: 10 }}>
					{groups.length === 0 ? (
						<Empty>No groups.</Empty>
					) : (
						groups.slice(0, 300).map((group) => (
							<GroupRow key={group.id} href={buildHref("groups", { group: group.id })} $active={selected && selected.id === group.id}>
								<GroupTitle>
									<strong style={{ overflowWrap: "anywhere" }}>{group.name}</strong>
									<Badge nowrap>{group.count}</Badge>
									<Badge color={theme.color.accent} nowrap>
										{conf(group.maxConfidence)}
									</Badge>
								</GroupTitle>
								<Subtle>{group.canonical?.path ? loc(group.canonical) : `${group.kind} group`}</Subtle>
							</GroupRow>
						))
					)}
				</div>
			</Panel>
			<Stack>
				{selected ? (
					<>
						<Panel>
							<PanelHead>
								<Title>{selected.name}</Title>
								<Badge color={theme.color.violet}>{selected.kind}</Badge>
								<Subtle>
									{selected.count} util(s) · {selected.duplicates} duplicate · strongest {conf(selected.maxConfidence)} · weakest {conf(selected.minConfidence)}
								</Subtle>
							</PanelHead>
							{selected.canonical ? (
								<div style={{ fontSize: 12.5, color: theme.color.textDim, marginBottom: 6 }}>
									Canonical: <code>{loc(selected.canonical)}</code>
								</div>
							) : null}
							<div style={{ maxHeight: 220, overflow: "auto" }}>
								{selected.members.map((member) => (
									<MemberRow key={`${member.findingId}`} href={buildHref("groups", { group: selected.id, id: member.findingId })} $active={focused && focused.id === member.findingId}>
										<Ellipsis>{member.name}</Ellipsis>
										<span style={{ fontFamily: "'SFMono-Regular', Menlo, monospace", fontSize: 11 }}>{member.path}:{member.line}</span>
										<Badge nowrap>{conf(member.confidence)}</Badge>
									</MemberRow>
								))}
							</div>
						</Panel>
						{focused ? (
							<Panel $accent={focused.color}>
								<PanelHead>
									<Title>
										{focused.left?.name ?? "—"} <Subtle>vs</Subtle> {focused.right?.name ?? "—"}
									</Title>
									<Badge color={focused.color}>{focused.label}</Badge>
									<Badge color={theme.color.accent} nowrap>
										{conf(focused.confidence)}
									</Badge>
									<a href={buildHref("pair", { id: focused.id })} style={{ fontSize: 12 }}>
										open pair →
									</a>
								</PanelHead>
								<div style={{ fontSize: 13, color: theme.color.textDim, marginBottom: 8 }}>{focused.message}</div>
								{pairsByFinding.get(focused.id) ? (
									<Diff pair={pairsByFinding.get(focused.id)} decision={focused.decision} signals={data.signals} />
								) : (
									<Diff pair={pairsByFinding.get(focused.id)} decision={focused.decision} signals={data.signals} />
								)}
								{focused.fix ? (
									<div style={{ marginTop: 10, fontSize: 13 }}>
										<strong style={{ color: theme.color.ok }}>Fix.</strong> {focused.fix.text}
									</div>
								) : null}
							</Panel>
						) : (
							<Panel>
								<Empty>This group has no pair to diff — see its members above.</Empty>
							</Panel>
						)}
					</>
				) : (
					<Panel>
						<Empty>Pick a group.</Empty>
					</Panel>
				)}
			</Stack>
		</Layout>
	);
};
