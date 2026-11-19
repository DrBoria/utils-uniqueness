// u07 canon — CSV join; options handled inside the body.

export function joinCsv(values: string[], delimiter?: string, quoteAll?: boolean): string {
	const sep = delimiter === undefined ? "," : delimiter;
	const forceQuotes = quoteAll === undefined ? false : quoteAll;
	const cells: string[] = [];
	for (const value of values) {
		const text = String(value);
		const needsQuotes = forceQuotes || text.includes(sep) || text.includes('"') || text.includes("\n");
		const escaped = text.replace(/"/g, '""');
		cells.push(needsQuotes ? `"${escaped}"` : escaped);
	}
	return cells.join(sep);
}
