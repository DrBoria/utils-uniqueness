// Number and path formatting shared by every screen, so "0.87" and "87%" mean
// the same thing in a badge, a bar and a table cell.

export const conf = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");

export const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—");

export const loc = (place) => (place?.line ? `${place.path}:${place.line}` : place?.path ?? "—");

export const shortPath = (value, keep = 3) => {
	const parts = String(value ?? "").split("/");
	if (parts.length <= keep) return String(value ?? "");

	return `…/${parts.slice(-keep).join("/")}`;
};

export const shortId = (id, length = 46) => {
	const text = String(id ?? "");
	const tail = text.includes(":") ? text.slice(text.indexOf(":") + 1) : text;

	return tail.length > length ? `${tail.slice(0, length)}…` : tail;
};

export const bytes = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`);

export const dateOf = (iso) => {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return String(iso ?? "");
	}
};
