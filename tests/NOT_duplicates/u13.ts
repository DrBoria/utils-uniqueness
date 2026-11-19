// u13 canon — truncateText: a STRING clamp (length + slice based).

export function truncateText(text: string, maxChars: number, ellipsis: string): string {
	if (typeof text !== "string") return "";
	const limit = Math.max(0, Math.trunc(maxChars));
	if (text.length <= limit) return text;
	if (limit <= ellipsis.length) return ellipsis.slice(0, limit);
	const cut = limit - ellipsis.length;
	return text.slice(0, cut) + ellipsis;
}
