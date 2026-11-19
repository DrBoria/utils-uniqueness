// u17 canon — processRecord: validate + transform + format in ONE function.

export function processRecord(raw: { name?: unknown; score?: unknown }): string {
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (name === "") return "invalid: name";
	const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0;
	const bounded = Math.max(0, Math.min(100, Math.round(score)));
	const grade = bounded >= 90 ? "A" : bounded >= 75 ? "B" : bounded >= 60 ? "C" : "D";
	return `${name} scored ${bounded} (${grade})`;
}
