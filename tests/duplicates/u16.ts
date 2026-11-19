// u16 app — same profile object as canon buildUserProfile, but the
// independent consts are reordered, the object is assembled via a spread of
// a partial base plus the remaining keys, and property order differs.

export function makeProfile(
	userId: string,
	given: string,
	family: string,
	years: number,
): { isAdult: boolean; initials: string; age: number; displayName: string; id: string } {
	const isAdult = years >= 18;
	const initials = `${given[0] ?? ""}${family[0] ?? ""}`.toUpperCase();
	const displayName = `${given} ${family}`.trim();
	const base = { isAdult, initials, age: years };
	return { ...base, displayName, id: userId };
}
