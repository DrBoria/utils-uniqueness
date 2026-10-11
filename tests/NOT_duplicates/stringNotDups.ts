// NOT duplicates: similar *shape* to the canonical string utils (same param
// count, string in / string out, a couple of method calls) but a DIFFERENT
// operation. These must NOT be flagged as duplicates of capitalize/slugify/etc.

// Same 1-arg string shape as `capitalize`, but it REVERSES the string.
export const reverseWord = (s: string): string => {
	if (!s) return "";
	return s.split("").reverse().join("");
};

// Same 1-arg string shape as `slugify`, but it counts words instead of
// producing a slug.
export const wordCount = (s: string): number =>
	s.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0).length;

// Same 2-arg (string, number) shape as `truncate`, but it PADS (not cuts).
export const padEnd = (s: string, len: number): string => {
	if (s.length >= len) return s;
	return s + " ".repeat(len - s.length);
};
