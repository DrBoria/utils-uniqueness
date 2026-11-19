// u03 canon — binary search over a sorted numeric array.

export function binarySearch(sorted: number[], target: number): number {
	let low = 0;
	let high = sorted.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const value = sorted[mid];
		if (value === target) return mid;
		if (value < target) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return -1;
}
