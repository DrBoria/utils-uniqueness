// u14 app — same deep flatten as canon deepFlatten, but the recursion is
// replaced by an explicit LIFO stack (reversed push order preserves the
// original left-to-right output order).

export function flattenIterative(input: unknown[]): unknown[] {
	const out: unknown[] = [];
	const stack: unknown[] = [...input].reverse();
	while (stack.length > 0) {
		const item = stack.pop();
		if (Array.isArray(item)) {
			for (let i = item.length - 1; i >= 0; i = i - 1) {
				stack.push(item[i]);
			}
		} else {
			out.push(item);
		}
	}
	return out;
}
