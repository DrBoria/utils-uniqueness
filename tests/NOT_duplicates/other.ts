export const reverseWords = (sentence: string) => {
	const tokens = sentence.split(" ");
	const flipped: string[] = [];
	for (let i = tokens.length - 1; i >= 0; i -= 1) {
		flipped.push(tokens[i].toUpperCase());
	}
	return flipped.join(" ");
};
