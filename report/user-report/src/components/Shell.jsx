import React from "react";
import styled from "styled-components";
import { buildHref } from "../utils/router";
import { Badge } from "./ui";
import { dateOf } from "../utils/format";
import { NAV } from "../navigation";
import { theme, MARK_COLOR } from "../theme";

// The frame: where the run came from, what it found, and the legend that gives
// every colour on the page a meaning. The legend reads the signal list out of the
// payload — the same list the report used — so a colour cannot be explained two
// different ways.

const Frame = styled.div`
	max-width: none;
	margin: 0 auto;
	padding: ${(p) => p.theme.space(5)} ${(p) => p.theme.space(4)} 64px;
`;

const Head = styled.header`
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: ${(p) => p.theme.space(3)};
	padding-bottom: ${(p) => p.theme.space(3)};
	border-bottom: 1px solid ${(p) => p.theme.color.border};
	margin-bottom: ${(p) => p.theme.space(4)};
`;

const Repo = styled.h1`
	font-size: 18px;
	margin: 0;
	letter-spacing: 0.2px;
`;

const Tabs = styled.nav`
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-bottom: ${(p) => p.theme.space(4)};
`;

const TabLink = styled.a`
	padding: 6px 12px;
	border-radius: ${(p) => p.theme.radius.sm};
	font-size: 13px;
	font-weight: 600;
	color: ${(p) => (p.$active ? p.theme.color.text : p.theme.color.textDim)};
	background: ${(p) => (p.$active ? p.theme.color.panelAlt : "transparent")};
	border: 1px solid ${(p) => (p.$active ? p.theme.color.borderStrong : "transparent")};
	&:hover { text-decoration: none; color: ${(p) => p.theme.color.text}; }
`;

const Legend = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: ${(p) => p.theme.space(3)};
	margin-top: ${(p) => p.theme.space(3)};
	padding-top: ${(p) => p.theme.space(3)};
	border-top: 1px dashed ${(p) => p.theme.color.border};
	font-size: 12px;
	color: ${(p) => p.theme.color.textFaint};
`;

const Swatch = styled.span`
	display: inline-block;
	width: 10px;
	height: 10px;
	border-radius: 2px;
	background: ${(p) => p.$color};
	margin-right: 5px;
	vertical-align: baseline;
`;

export const Shell = ({ data, tab, children }) => {
	const { meta, stats, signals } = data;

	return (
		<Frame>
			<Head>
				<Repo>{meta.repoName}</Repo>
				<Badge color={theme.color.accent}>{meta.tool}@{meta.version}</Badge>
				<span style={{ color: theme.color.textDim, fontSize: 12 }}>
					{meta.filesScanned} file(s) scanned · {meta.appCount} app util(s) · {meta.canonCount} canonical util(s) · generated {dateOf(meta.generatedAt)}
				</span>
			</Head>
			<Tabs>
				{NAV.map(([key, label]) => (
					<TabLink key={key} href={buildHref(key)} $active={tab === key || (tab === "pair" && key === "findings")}>
						{label}
					</TabLink>
				))}
			</Tabs>
			{children}
			<Legend>
				<span>
					<strong style={{ color: theme.color.textDim }}>{stats.findings}</strong> finding(s) · {stats.pairs} diff(s) · {stats.groups} group(s)
				</span>
				<span style={{ color: theme.color.textDim }}>In the diff gutter, per group:</span>
				<span>
					<Swatch $color={MARK_COLOR.same} /> this group sees the two rows as the same
				</span>
				<span>
					<Swatch $color={MARK_COLOR.diff} /> this group sees them as different
				</span>
				{(signals ?? []).map((signal) => (
					<span key={signal.key} title={signal.what}>
						<Swatch $color={signal.color} />
						{signal.label}
					</span>
				))}
			</Legend>
		</Frame>
	);
};
