// E2E test code living in an `e2e/` directory (not named *.e2e.*).
// Must be excluded like other test code — it is not a production util.
export const entryFilter = (list: string[]) => list.filter((e) => e.length > 0);

export const flush = (queue: unknown[]) => {
	const out: unknown[] = [];
	for (const item of queue) out.push(item);
	return out;
};
