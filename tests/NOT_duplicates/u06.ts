// u06 canon — HTTP status classification with an if/else chain.

export function httpStatusKind(status: number): string {
	if (status >= 100 && status < 200) return "info";
	else if (status >= 200 && status < 300) return "ok";
	else if (status >= 300 && status < 400) return "redirect";
	else if (status >= 400 && status < 500) return "client";
	else if (status >= 500 && status < 600) return "server";
	return "unknown";
}
