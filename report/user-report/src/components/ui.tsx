import { theme } from "../theme";
import React from "react";
import styled from "styled-components";

// The small vocabulary every screen shares: a panel, a badge, a stat cell, a
// search box, an empty state. Keeping it here means a new screen is a layout,
// not a second design.

export const Panel = styled.section`
	background: ${(p) => p.theme.color.panel};
	border: 1px solid ${(p) => p.theme.color.border};
	border-radius: ${(p) => p.theme.radius.md};
	padding: ${(p) => p.theme.space(4)};
	min-width: 0;
	max-width: 100%;
	${(p) => (p.$accent ? `border-left: 3px solid ${p.$accent};` : "")}
`;

export const PanelHead = styled.header`
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: ${(p) => p.theme.space(3)};
	margin-bottom: ${(p) => p.theme.space(3)};
	min-width: 0;
`;

export const Title = styled.h2`
	font-size: 15px;
	font-weight: 650;
	margin: 0;
	letter-spacing: 0.2px;
	flex: 1 1 auto;
	min-width: 0;
	overflow-wrap: anywhere;
`;

export const Subtle = styled.span`
	color: ${(p) => p.theme.color.textFaint};
	font-size: 12px;
`;

export const Mono = styled.code`
	font-family: ${(p) => p.theme.font.mono};
	font-size: 12.5px;
	overflow-wrap: anywhere;
	color: ${(p) => p.theme.color.text};
`;

const BadgeBox = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 11.5px;
	font-weight: 600;
	letter-spacing: 0.2px;
	white-space: ${(p) => (p.$nowrap ? "nowrap" : "normal")};
	max-width: 100%;
	color: ${(p) => p.$color ?? p.theme.color.textDim};
	background: ${(p) => (p.$color ? `${p.$color}1f` : `${p.theme.color.border}88`)};
	border: 1px solid ${(p) => (p.$color ? `${p.$color}55` : p.theme.color.border)};
`;

export const Badge = ({ children, color, nowrap, ...rest }) => (
	<BadgeBox $color={color} $nowrap={nowrap} {...rest}>
		{children}
	</BadgeBox>
);

export const Empty = ({ children }) => <div style={{ padding: "28px 8px", textAlign: "center", color: theme.color.textFaint, fontSize: 13 }}>{children}</div>;

const SearchInput = styled.input`
	width: 100%;
	background: ${(p) => p.theme.color.panelAlt};
	border: 1px solid ${(p) => p.theme.color.border};
	border-radius: ${(p) => p.theme.radius.sm};
	color: ${(p) => p.theme.color.text};
	padding: 8px 11px;
	font-size: 13px;
	outline: none;
	&:focus { border-color: ${(p) => p.theme.color.borderStrong}; }
	&::placeholder { color: ${(p) => p.theme.color.textFaint}; }
`;

export const SearchBox = ({ value, onChange, placeholder = "Filter…" }) => <SearchInput value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />;

const StatGrid = styled.div`
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
	gap: ${(p) => p.theme.space(2)};
`;

const StatCell = styled.div`
	background: ${(p) => p.theme.color.panelAlt};
	border: 1px solid ${(p) => p.theme.color.border};
	border-radius: ${(p) => p.theme.radius.sm};
	padding: 10px 12px;
`;

export const Stat = ({ label, value, color }) => (
	<StatCell>
		<div style={{ fontSize: 21, fontWeight: 700, color: color ?? theme.color.text, lineHeight: 1.2 }}>{value}</div>
		<div style={{ fontSize: 11, color: theme.color.textDim, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
	</StatCell>
);

export const Stats = ({ children }) => <StatGrid>{children}</StatGrid>;

export const Stack = styled.div`
	display: flex;
	flex-direction: column;
	gap: ${(p) => p.theme.space(3)};
	min-width: 0;
`;

export const Row = styled.div`
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: ${(p) => p.theme.space(2)};
	min-width: 0;
`;
