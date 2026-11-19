// u07 app — same CSV join, but options arrive as a destructured object with
// default parameters instead of plain params defaulted inside the body.

export function joinDelimited(
	values: string[],
	{ separator = ",", quoteAll = false }: { separator?: string; quoteAll?: boolean } = {},
): string {
	const cells: string[] = [];
	for (const value of values) {
		const text = String(value);
		const needsQuotes = quoteAll || text.includes(separator) || text.includes('"') || text.includes("\n");
		const escaped = text.replace(/"/g, '""');
		cells.push(needsQuotes ? `"${escaped}"` : escaped);
	}
	return cells.join(separator);
}
