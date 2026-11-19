// u15 canon — summarizeOrders: map -> filter -> reduce computing revenue.

type Order = { id: string; total: number; status: string };

export function summarizeOrders(orders: Order[]): number {
	return orders
		.map((order) => ({ id: order.id, total: order.total, status: order.status }))
		.filter((order) => order.status === "paid" && order.total > 0)
		.reduce((sum, order) => sum + order.total, 0);
}
