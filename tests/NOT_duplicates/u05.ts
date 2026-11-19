// u05 canon — password strength check written with early returns.

export function passwordStrength(password: string, minLength: number): number {
	if (typeof password !== "string") return 0;
	if (password.length < minLength) return 0;
	let score = 1;
	if (/[a-z]/.test(password)) score = score + 1;
	if (/[A-Z]/.test(password)) score = score + 1;
	if (/\d/.test(password)) score = score + 1;
	if (/[^A-Za-z0-9]/.test(password)) score = score + 1;
	if (password.length >= minLength + 4) score = score + 1;
	return Math.min(5, score);
}
