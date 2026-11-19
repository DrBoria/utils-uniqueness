// u17 app — canon processRecord SPLIT into two functions whose combined
// bodies equal the canon body: cleanRecord does validate + clamp,
// formatGrade does grade + render.

export function cleanRecord(
	raw: { name?: unknown; score?: unknown },
): { name: string; bounded: number } | null {
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (name === "") return null;
	const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0;
	const bounded = Math.max(0, Math.min(100, Math.round(score)));
	return { name, bounded };
}

export function formatGrade(name: string, bounded: number): string {
	const grade = bounded >= 90 ? "A" : bounded >= 75 ? "B" : bounded >= 60 ? "C" : "D";
	return `${name} scored ${bounded} (${grade})`;
}
