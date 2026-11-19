// u03 app — NEGATIVE: linear search. Same signature, domain and return contract
// as canon binarySearch (find target, return index or -1) but an O(n) scan.

export function linearSearch(values: number[], target: number): number {
	for (let i = 0; i < values.length; i = i + 1) {
		if (values[i] === target) {
			return i;
		}
	}
	return -1;
}
