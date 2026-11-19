// u09 canon — fetch + validate + project, written with async/await.

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function loadUser(fetcher: FetchLike, userId: string): Promise<{ id: string; name: string }> {
	const response = await fetcher(`/users/${userId}`);
	if (!response.ok) {
		throw new Error(`user request failed: ${response.status}`);
	}
	const payload = (await response.json()) as { id?: unknown; name?: unknown };
	if (typeof payload.id !== "string" || typeof payload.name !== "string") {
		throw new Error("user payload malformed");
	}
	return { id: payload.id, name: payload.name.trim() };
}
