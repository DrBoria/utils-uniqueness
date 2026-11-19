// u02 app — parameterized copy of paginate: every identifier renamed and the
// per-page cap literal changed (100 -> 50), return keys renamed too.

export function sliceWindow(
	itemCount: number,
	pageIndex: number,
	pageSize: number,
): { from: number; to: number; page: number; size: number } {
	const safeSize = Math.max(1, Math.min(50, Math.trunc(pageSize)));
	const pageCount = Math.max(1, Math.ceil(itemCount / safeSize));
	const safeIndex = Math.max(1, Math.min(pageCount, Math.trunc(pageIndex)));
	const from = (safeIndex - 1) * safeSize;
	const to = Math.min(itemCount, from + safeSize);
	return { from, to, page: safeIndex, size: safeSize };
}
