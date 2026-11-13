// Minimal hash router: `#/pair?id=duplicate:src/a.ts#foo=>src/utils.ts#bar`.
//
// Deep links matter here: a pair is something you send to a colleague ("look at
// this one"), and the browser's back button should behave. No dependency is
// needed for five routes.

import { useEffect, useState } from "react";

export const TABS = ["summary", "groups", "folders", "findings", "pair"];

const parseHash = () => {
	const raw = window.location.hash.replace(/^#\/?/, "");
	const [path, query = ""] = raw.split("?");
	const params = Object.fromEntries(new URLSearchParams(query));
	const tab = TABS.includes(path) ? path : "summary";

	return { tab, params };
};

export const buildHref = (tab, params = {}) => {
	const clean = Object.entries(params).filter(([, value]) => value != null && value !== "");
	const qs = new URLSearchParams(clean).toString();

	return `#/${tab}${qs ? `?${qs}` : ""}`;
};

export const useRoute = () => {
	const [route, setRoute] = useState(parseHash);

	useEffect(() => {
		const onChange = () => setRoute(parseHash());
		window.addEventListener("hashchange", onChange);
		if (!window.location.hash) window.location.hash = "#/summary";

		return () => window.removeEventListener("hashchange", onChange);
	}, []);

	return route;
};
