// u18 canon — isSortedAscending: pairwise ascending check.

export function isSortedAscending(values: number[]): boolean {
	if (values.length <= 1) return true;
	for (let i = 1; i < values.length; i = i + 1) {
		const prev = values[i - 1];
		const curr = values[i];
		if (prev > curr) {
			return false;
		}
	}
	return true;
}
