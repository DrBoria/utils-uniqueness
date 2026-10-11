// Bodyless function signatures: overloads + ambient declarations.
// These produce descriptors with a NULL bodyTree. The pipeline must not
// crash on them and must not report them as duplicates.

export function graphql<TData>(text: string, vars?: Record<string, unknown>): Promise<TData>;
export function graphql(text: string): Promise<unknown>;
export function graphql(text: string, vars?: Record<string, unknown>): Promise<unknown> {
	return Promise.resolve(JSON.parse(text));
}

declare function useFragment<TData>(fragment: string): (data: unknown) => TData;

export const real = (x: number) => x * 2;
