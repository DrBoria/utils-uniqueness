import React from "react";
import styled from "styled-components";
import { Badge, Panel, PanelHead, Stats, Stat, Subtle, Title, Empty } from "../components/ui";
import { buildHref } from "../utils/router";
import { KIND } from "../../../../constants";
import { kindOf, KIND_TILES } from "../../../errorTypes/vocabulary/labels";
import { theme } from "../theme";
import { conf, shortPath } from "../utils/format";

// What the run found, in one screen: the counts, the shape of the problem (which
// kinds of finding dominate) and the biggest similarity groups. A reader who
// opens only this screen should already know whether to keep reading.

const Grid = styled.div`
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: ${(p) => p.theme.space(3)};
	margin-top: ${(p) => p.theme.space(3)};
`;

const Line = styled.div`
	display: flex;
	align-items: baseline;
	gap: ${(p) => p.theme.space(2)};
	padding: 4px 0;
	border-bottom: 1px dashed ${(p) => p.theme.color.border};
	font-size: 13px;
	min-width: 0;
	&:last-child { border-bottom: none; }
`;

const Grow = styled.span`
	flex: 1 1 auto;
	min-width: 0;
	overflow-wrap: anywhere;
`;

// The tiles are the finding kinds, in the order the report reads them. The
// LABEL is plural here (a tile counts several findings) but the COLOUR is the
// shared one — hardcoding it per tile let the page and the terminal report show
// the same kind in two different colours.

export const SummaryScreen = ({ data }) => {
	const { stats, meta, groups, byKind } = data;
	const countOf = (kind) => byKind.find((k) => k.value === kind)?.count ?? 0;
	const top = groups.slice(0, 8);

	return (
		<>
			<Stats>
				<Stat label="Findings" value={stats.findings} />
				<Stat label="Duplicates" value={stats.duplicates} color={theme.color.danger} />
				<Stat label="Similar" value={stats.similar} color={theme.color.warn} />
				<Stat label="Diffs" value={stats.pairs} color={theme.color.accent} />
				<Stat label="Groups" value={stats.groups} color={theme.color.violet} />
				<Stat label="Folders" value={stats.folders} color={theme.color.teal} />
			</Stats>
			<Grid>
				<Panel>
					<PanelHead>
						<Title>What the run concluded</Title>
						<Subtle>{meta.repoName}</Subtle>
					</PanelHead>
					{KIND_TILES.map(({ key, label }) => (
						<Line key={key}>
							<Badge color={kindOf(key).color} nowrap>
								{label}
							</Badge>
							<Grow />
							<strong>{countOf(key)}</strong>
						</Line>
					))}
					<div style={{ marginTop: 12, fontSize: 12.5, color: theme.color.textDim }}>
						Compared {meta.appCount} app util(s) against {meta.canonCount} canonical util(s) in {meta.filesScanned} file(s).
						{meta.catalogPath ? ` Catalog: ${meta.catalogPath}.` : " No catalog — only live pairs were compared."}
					</div>
				</Panel>
				<Panel>
					<PanelHead>
						<Title>Biggest similarity groups</Title>
						<a href={buildHref("groups")} style={{ fontSize: 12 }}>
							all groups →
						</a>
					</PanelHead>
					{top.length === 0 ? (
						<Empty>No groups — nothing matched anything.</Empty>
					) : (
						top.map((group) => (
							<Line key={group.id}>
								<Grow>
									<a href={buildHref("groups", { group: group.id })}>{group.name}</a>
									<div style={{ color: theme.color.textFaint, fontSize: 11.5 }}>
										{group.canonical?.path ? shortPath(group.canonical.path, 2) : `${group.kind} group`}
									</div>
								</Grow>
								<Badge nowrap>{group.count} util(s)</Badge>
								<Badge color={theme.color.accent} nowrap>
									{conf(group.maxConfidence)}
								</Badge>
							</Line>
						))
					)}
				</Panel>
				<Panel>
					<PanelHead>
						<Title>How the verdict is computed</Title>
						<Subtle>weights × group scores, normalized</Subtle>
					</PanelHead>
					{(data.signals ?? []).map((signal) => (
						<Line key={signal.key}>
							<span style={{ color: signal.color, fontWeight: 600, minWidth: 96 }}>{signal.label}</span>
							<Grow style={{ color: theme.color.textDim }}>{signal.what}</Grow>
							<Badge nowrap>{data.decisions?.weights?.[signal.key] != null ? `${Math.round(data.decisions.weights[signal.key] * 100)}%` : "—"}</Badge>
						</Line>
					))}
					<div style={{ marginTop: 12, fontSize: 12.5, color: theme.color.textDim }}>
						A pair becomes a <strong style={{ color: theme.color.danger }}>duplicate</strong> at {conf(data.decisions?.thresholds?.duplicate)} and a{" "}
						<strong style={{ color: theme.color.warn }}>similar</strong> at {conf(data.decisions?.thresholds?.similar)} — unless a gate vetoes it (small body, mismatched return kind,
						different AST). Every gate that fired is named under the diff.
					</div>
				</Panel>
			</Grid>
		</>
	);
};
