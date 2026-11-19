// u06 app — same HTTP status classification, if/else chain collapsed into a
// nested ternary chain with identical range comparisons.

export function statusCategory(code: number): string {
	return code >= 100 && code < 200
		? "info"
		: code >= 200 && code < 300
			? "ok"
			: code >= 300 && code < 400
				? "redirect"
				: code >= 400 && code < 500
					? "client"
					: code >= 500 && code < 600
						? "server"
						: "unknown";
}
