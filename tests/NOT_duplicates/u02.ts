// u02 canon — pagination window with one set of constants.

export function paginate(
	totalItems: number,
	page: number,
	perPage: number,
): { start: number; end: number; page: number; perPage: number } {
	const safePerPage = Math.max(1, Math.min(100, Math.trunc(perPage)));
	const totalPages = Math.max(1, Math.ceil(totalItems / safePerPage));
	const safePage = Math.max(1, Math.min(totalPages, Math.trunc(page)));
	const start = (safePage - 1) * safePerPage;
	const end = Math.min(totalItems, start + safePerPage);
	return { start, end, page: safePage, perPage: safePerPage };
}
