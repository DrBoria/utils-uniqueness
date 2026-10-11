export const formatTotal = (amount: number, currency: string) => {
	const sign = amount < 0 ? "-" : "";
	const abs = Math.abs(amount);
	const rounded = Math.round(abs * 100) / 100;
	return `${sign}${rounded.toFixed(2)} ${currency}`;
};
