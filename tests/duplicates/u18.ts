// u18 app — the mirror image of canon isSortedAscending: the loop runs
// BACKWARDS, the comparison is flipped (curr < prev instead of prev > curr),
// the guard is inverted (< 2 instead of <= 1), and the pairwise locals are
// declared in the opposite order. Same algorithm, nothing copied verbatim.

export function isNonDecreasing(sequence: number[]): boolean {
	if (sequence.length < 2) {
		return true;
	}
	for (let i = sequence.length - 1; i > 0; i = i - 1) {
		const curr = sequence[i];
		const prev = sequence[i - 1];
		if (curr < prev) {
			return false;
		}
	}
	return true;
}
