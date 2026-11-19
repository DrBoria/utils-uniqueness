// u15 app — same paid-orders revenue pipeline as canon summarizeOrders, but
// the inline arrows become named intermediate helpers, the map/filter order
// is swapped (semantics preserved: the map only projects), and the reduce
// accumulator is a plain number.

type LineItem = { id: string; total: number; status: string };

export function tallyPaidOrders(rows: LineItem[]): number {
	const keep = (row: LineItem) => row.status === "paid" && row.total > 0;
	const amount = (row: LineItem) => row.total;
	const add = (acc: number, value: number) => acc + value;
	return rows
		.filter(keep)
		.map(amount)
		.reduce(add, 0);
}
