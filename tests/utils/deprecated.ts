// Ground truth from core/utils/utils/zod.ts — deprecated throw-stubs.
// In the real run these produced 34 similar-tier false positives at exactly
// 0.53: every zero-arg one-liner in the app matched them (signature 1.00,
// structure/ast/cf all coarse). A throw-stub is not a reuse target.

/**
 * @deprecated use day instead
 */
export function date() {
	throw new Error("use day instead");
}

/**
 * @deprecated use TSTZ instead
 */
export function datetime() {
	throw new Error("use TSTZ instead");
}
