// u10 canon — parse + validate settings; errors are THROWN from a try/catch.

export function parseSettings(raw: string): { theme: string; fontSize: number } {
	try {
		const parsed = JSON.parse(raw) as { theme?: unknown; fontSize?: unknown };
		if (typeof parsed.theme !== "string") {
			throw new Error("theme must be a string");
		}
		if (typeof parsed.fontSize !== "number" || !Number.isFinite(parsed.fontSize)) {
			throw new Error("fontSize must be a finite number");
		}
		const fontSize = Math.max(8, Math.min(72, Math.round(parsed.fontSize)));
		return { theme: parsed.theme.toLowerCase(), fontSize };
	} catch (err) {
		throw new Error(`invalid settings: ${(err as Error).message}`);
	}
}
