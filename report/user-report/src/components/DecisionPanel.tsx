import { theme } from "../theme";
import React from "react";
import styled from "styled-components";
import { Badge, Panel, PanelHead, Subtle, Title } from "./ui";
import { conf, pct } from "../utils/format";

// The decision-maker's answer, drawn.
//
// The verdict is one number, and a number alone is not arguable. So every pair
// carries the four groups that produced it: the score each group gave, the
// weight it was given, its SHARE of the final number, and the raw evidence the
// matcher used (shared subtrees, parameter roles, branch kinds…). Under the bars
// the same facts are written as sentences — one per signal, one per gate that
// stopped a high score from becoming a duplicate.
//
// Everything here comes from `explain()` on the Node side: the page renders the
// numbers, it never recomputes them.

const Bar = styled.div`
	display: grid;
	grid-template-columns: 96px minmax(0, 1fr) 120px;
	align-items: center;
	gap: ${(p) => p.theme.space(2)};
	margin-bottom: 6px;
`;

const Track = styled.div`
	position: relative;
	height: 10px;
	border-radius: 999px;
	background: ${(p) => p.theme.color.panelAlt};
	border: 1px solid ${(p) => p.theme.color.border};
	overflow: hidden;
`;

const Fill = styled.div`
	position: absolute;
	inset: 0 auto 0 0;
	width: ${(p) => `${Math.round(p.$score * 100)}%`};
	background: ${(p) => p.$color};
	opacity: ${(p) => (p.$applied ? 1 : 0.25)};
`;

const ChipRow = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin: 0 0 10px 0;
`;

const Chip = styled.span`
	font-family: ${(p) => p.theme.font.mono};
	font-size: 11px;
	padding: 1px 6px;
	border-radius: 4px;
	color: ${(p) => p.theme.color.textDim};
	background: ${(p) => p.theme.color.panelAlt};
	border: 1px solid ${(p) => p.theme.color.border};
`;

const Why = styled.ul`
	margin: 0;
	padding-left: 18px;
	font-size: 12.5px;
	color: ${(p) => p.theme.color.textDim};
`;

const WhyLine = styled.li`
	margin-bottom: 3px;
	color: ${(p) => (p.$tone === "veto" ? p.theme.color.warn : p.$tone === "disagree" ? p.theme.color.textDim : p.theme.color.textDim)};
`;

export const SignalPills = ({ decision }) => (
	<>
		{(decision?.signals ?? []).map((signal) => (
			<Badge key={signal.key} color={signal.color} nowrap title={`${signal.label} ${conf(signal.score)} · ${pct(signal.weight)} weight · ${pct(signal.contribution)} of the verdict`}>
				{signal.short} {conf(signal.score)}
			</Badge>
		))}
	</>
);

export const DecisionPanel = ({ decision, fix, title = "Why this verdict", accent }) => {
	if (!decision) return null;

	return (
		<Panel $accent={accent}>
			<PanelHead>
				<Title>{title}</Title>
				<Badge color={accent} nowrap>
					confidence {conf(decision.confidence)} ({pct(decision.confidence)})
				</Badge>
				<Subtle>
					duplicate ≥ {conf(decision.thresholds.duplicate)} · similar ≥ {conf(decision.thresholds.similar)}
				</Subtle>
			</PanelHead>
			{(decision.signals ?? []).map((signal) => (
				<div key={signal.key}>
					<Bar title={signal.what}>
						<span style={{ color: signal.color, fontWeight: 600 }}>{signal.label}</span>
						<Track>
							<Fill $score={signal.score} $color={signal.color} $applied={signal.applied} />
						</Track>
						<Subtle>
							{conf(signal.score)} · w {pct(signal.weight)} · {pct(signal.contribution)}
						</Subtle>
					</Bar>
					{signal.evidence?.length ? (
						<ChipRow>
							{signal.evidence.map((chip) => (
								<Chip key={chip.key} title={chip.key}>
									{chip.label}: {chip.value}
								</Chip>
							))}
						</ChipRow>
					) : null}
				</div>
			))}
			<Why>
				{(decision.why ?? []).map((line, index) => (
					<WhyLine key={index} $tone={line.tone}>
						{line.text}
					</WhyLine>
				))}
			</Why>
			{fix ? (
				<div style={{ marginTop: 12, fontSize: 13 }}>
					<strong style={{ color: theme.color.ok }}>Fix.</strong> {fix.text}
				</div>
			) : null}
		</Panel>
	);
};
