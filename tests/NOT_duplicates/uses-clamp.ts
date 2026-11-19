import { clamp } from "./format";

export const adjustVolume = (level: number, min: number, max: number) => {
	const safe = clamp(level, min, max);
	if (safe < min) return min;
	if (safe > max) return max;
	return safe;
};
