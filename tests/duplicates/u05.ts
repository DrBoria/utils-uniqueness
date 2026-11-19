// u05 app — same password scoring, but the two early-return guards become
// nested positive ifs with a single fall-through return 0.

export function nestedPasswordScore(secret: string, minLen: number): number {
	if (typeof secret === "string") {
		if (secret.length >= minLen) {
			let score = 1;
			if (/[a-z]/.test(secret)) score = score + 1;
			if (/[A-Z]/.test(secret)) score = score + 1;
			if (/\d/.test(secret)) score = score + 1;
			if (/[^A-Za-z0-9]/.test(secret)) score = score + 1;
			if (secret.length >= minLen + 4) score = score + 1;
			return Math.min(5, score);
		}
	}
	return 0;
}
