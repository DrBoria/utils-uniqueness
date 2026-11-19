// u16 canon — buildUserProfile: object built in a fixed property order.

export function buildUserProfile(
	id: string,
	firstName: string,
	lastName: string,
	age: number,
): { id: string; displayName: string; age: number; initials: string; isAdult: boolean } {
	const displayName = `${firstName} ${lastName}`.trim();
	const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
	const isAdult = age >= 18;
	return {
		id,
		displayName,
		age,
		initials,
		isAdult,
	};
}
