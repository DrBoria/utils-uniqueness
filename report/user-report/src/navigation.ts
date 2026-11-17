// The page's screens, declared ONCE.
//
// The router resolves a tab to a component (App), and the tab bar renders the
// same list with labels (Shell). Two hand-written lists drifted the moment a
// screen was added, so the order, the key and the label live here.

import { SummaryScreen } from "./screens/SummaryScreen";
import { GroupsScreen } from "./screens/GroupsScreen";
import { FoldersScreen } from "./screens/FoldersScreen";
import { FindingsScreen } from "./screens/FindingsScreen";
import { PairScreen } from "./screens/PairScreen";

// THREE tabs, because there are three questions worth a top-level entry:
// what did the run conclude (summary), where is it (by folder), and which rows
// are worth opening (findings — which carries the similarity filters now).
//
// The old "By similarity" tab answered a fourth question the findings screen
// already answers by score, so it is still a valid screen (a summary group links
// to it) but no longer a tab. Same for the single-pair view.
export const SCREENS = [
	{ key: "summary", label: "Summary", component: SummaryScreen },
	{ key: "folders", label: "By folder", component: FoldersScreen },
	{ key: "findings", label: "Findings", component: FindingsScreen },
	{ key: "groups", label: "By similarity", component: GroupsScreen, nav: false },
	{ key: "pair", label: "Pair", component: PairScreen, nav: false },
];

// The tab bar entries, in declaration order.
export const NAV = SCREENS.filter((s) => s.nav !== false).map(({ key, label }) => [key, label]);

export const screenOf = (key) => (SCREENS.find((s) => s.key === key) ?? SCREENS[0]).component;
