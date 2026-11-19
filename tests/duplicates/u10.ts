// u10 app — same parse + validate steps as canon parseSettings, but the
// try/catch becomes a promise .catch chain and thrown errors become a
// returned { ok, value, error } object.

export function readSettings(
	raw: string,
): Promise<{ ok: boolean; value: { theme: string; fontSize: number } | null; error: string | null }> {
	return Promise.resolve()
		.then(() => JSON.parse(raw) as { theme?: unknown; fontSize?: unknown })
		.then((parsed) => {
			if (typeof parsed.theme !== "string") {
				throw new Error("theme must be a string");
			}
			if (typeof parsed.fontSize !== "number" || !Number.isFinite(parsed.fontSize)) {
				throw new Error("fontSize must be a finite number");
			}
			const fontSize = Math.max(8, Math.min(72, Math.round(parsed.fontSize)));
			return { ok: true, value: { theme: parsed.theme.toLowerCase(), fontSize }, error: null };
		})
		.catch((err) => ({ ok: false, value: null, error: `invalid settings: ${(err as Error).message}` }));
}
