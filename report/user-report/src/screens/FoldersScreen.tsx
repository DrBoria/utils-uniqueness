import { theme } from "../theme";
import React, { useState } from "react";
import styled from "styled-components";
import { Badge, Panel, PanelHead, Subtle, Title, SearchBox, Empty, Stack } from "../components/ui";
import { DecisionPanel } from "../components/DecisionPanel";
import { Diff } from "../components/pair";
import { buildHref } from "../utils/router";
import { conf, loc } from "../utils/format";

// The report BY FOLDER.
//
// A verdict is a fact about a folder before it is a fact about a file — the team
// that owns `src/app/order` fixes what is in it. The tree carries the counts of
// every kind of finding BELOW each folder, so a collapsed row already says how
// much work is inside; opening a folder lists its findings, each with the diff
// and the decision strip inside it.

const Layout = styled.div`
	display: grid;
	grid-template-columns: minmax(260px, 380px) minmax(0, 1fr);
	gap: ${(p) => p.theme.space(3)};
	align-items: start;
	@media (max-width: 1000px) { grid-template-columns: minmax(0, 1fr); }
`;

const Node = styled.a`
	display: block;
	padding: 3px 6px 3px ${(p) => `${8 + p.$depth * 14}px`};
	border-radius: ${(p) => p.theme.radius.sm};
	font-size: 13px;
	background: ${(p) => (p.$active ? p.theme.color.panelAlt : "transparent")};
	border: 1px solid ${(p) => (p.$active ? p.theme.color.borderStrong : "transparent")};
	&:hover { background: ${(p) => p.theme.color.panelAlt}; text-decoration: none; }
`;

const NodeHead = styled.div`
	display: flex;
	align-items: baseline;
	gap: 6px;
	min-width: 0;
`;

const Name = styled.span`
	font-family: ${(p) => p.theme.font.mono};
	font-size: 12px;
	overflow-wrap: anywhere;
`;

const Counts = styled.span`
	display: flex;
	gap: 4px;
	flex-wrap: wrap;
`;

const FindingLink = styled.a`
	display: block;
	padding: 4px 6px;
	font-size: 12.5px;
	color: ${(p) => (p.$active ? p.theme.color.text : p.theme.color.textDim)};
	background: ${(p) => (p.$active ? p.theme.color.panelAlt : "transparent")};
	border-left: 2px solid ${(p) => (p.$active ? p.$color : "transparent")};
	&:hover { background: ${(p) => p.theme.color.panelAlt}; text-decoration: none; }
`;

const flatten = (node, out = []) => {
	out.push(node);
	for (const child of node.children) flatten(child, out);

	return out;
};

// The findings of a folder AND everything under it. A collapsed row already
// counts the whole subtree, so its list must show the same subtree — otherwise a
// folder that only holds subfolders (e.g. `src/backend/profiler`) lists nothing.
const subtreeFindings = (node) => {
	const out = [...node.findings];
	for (const child of node.children) out.push(...subtreeFindings(child));

	return out;
};

export const FoldersScreen = ({ data, params }) => {
	const [filter, setFilter] = useState("");
	const nodes = flatten(data.folders).filter((node) => node.counts.total > 0);
	const visible = nodes.filter((node) => !filter || node.path.toLowerCase().includes(filter.toLowerCase()));
	const selected = visible.find((node) => node.path === params.folder) ?? visible.find((n) => n.counts.total > 0) ?? null;
	const findingsById = new Map(data.findings.map((f) => [f.id, f]));
	const pairsByFinding = new Map(data.pairs.map((p) => [p.findingId, p]));
	const selectedFindings = selected ? subtreeFindings(selected).map((id) => findingsById.get(id)).filter(Boolean) : [];
	const focused = selectedFindings.find((f) => f.id === params.id) ?? selectedFindings[0] ?? null;
	const pair = focused ? pairsByFinding.get(focused.id) : null;

	return (
		<Layout>
			<Panel>
				<PanelHead>
					<Title>Folders</Title>
					<Subtle>{nodes.length} folder(s)</Subtle>
				</PanelHead>
				<SearchBox value={filter} onChange={setFilter} placeholder="Filter folders…" />
				<div style={{ marginTop: 10 }}>
					{visible.length === 0 ? (
						<Empty>No folders.</Empty>
					) : (
						visible.map((node) => (
							<Node key={node.path} href={buildHref("folders", { folder: node.path })} $depth={node.depth} $active={selected && selected.path === node.path}>
								<NodeHead>
									<Name>{node.name}</Name>
									<Counts>
										{node.counts.duplicate ? <Badge color={theme.color.danger} nowrap>{node.counts.duplicate} dup</Badge> : null}
										{node.counts.similar ? <Badge color={theme.color.warn} nowrap>{node.counts.similar} sim</Badge> : null}
										{node.counts.part ? <Badge color={theme.color.part} nowrap>{node.counts.part} part</Badge> : null}
										{node.counts.trash ? <Badge color={theme.color.textDim} nowrap>{node.counts.trash} trash</Badge> : null}
										<Badge nowrap>{node.counts.total}</Badge>
									</Counts>
								</NodeHead>
							</Node>
						))
					)}
				</div>
			</Panel>
			<Stack>
				{selected ? (
					<>
						<Panel>
							<PanelHead>
								<Title>{selected.path}</Title>
								<Subtle>{selected.counts.total} finding(s) in this folder and below</Subtle>
							</PanelHead>
							<div style={{ maxHeight: 200, overflow: "auto" }}>
								{selectedFindings.map((finding) => (
									<FindingLink key={finding.id} href={buildHref("folders", { folder: selected.path, id: finding.id })} $active={focused && focused.id === finding.id} $color={finding.color}>
										<strong>{finding.left?.name ?? "—"}</strong> {finding.right?.name ? `→ ${finding.right.name}` : ""} <span style={{ opacity: 0.7 }}>{conf(finding.confidence)}</span>
										<div style={{ opacity: 0.6, fontSize: 11.5, fontFamily: "'SFMono-Regular', Menlo, monospace" }}>{loc(finding.left)}</div>
									</FindingLink>
								))}
							</div>
						</Panel>
						{focused ? (
							<Panel $accent={focused.color}>
								<PanelHead>
									<Title>
										{focused.left?.name ?? "—"}
										{focused.right?.name ? <Subtle> vs {focused.right.name}</Subtle> : null}
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
								{pair ? <Diff pair={pair} decision={focused.decision} signals={data.signals} /> : <DecisionPanel decision={focused.decision} fix={focused.fix} accent={focused.color} />}
								{focused.fix ? (
									<div style={{ marginTop: 10, fontSize: 13 }}>
										<strong style={{ color: theme.color.ok }}>Fix.</strong> {focused.fix.text}
									</div>
								) : null}
							</Panel>
						) : null}
					</>
				) : (
					<Panel>
						<Empty>Pick a folder.</Empty>
					</Panel>
				)}
			</Stack>
		</Layout>
	);
};
