// u09 app — same fetch + validate + project steps as canon loadUser, but the
// async/await flow is rewritten as a .then() chain.

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function fetchUserById(fetcher: FetchLike, userId: string): Promise<{ id: string; name: string }> {
	return fetcher(`/users/${userId}`)
		.then((response) => {
			if (!response.ok) {
				throw new Error(`user request failed: ${response.status}`);
			}
			return response.json();
		})
		.then((data) => {
			const payload = data as { id?: unknown; name?: unknown };
			if (typeof payload.id !== "string" || typeof payload.name !== "string") {
				throw new Error("user payload malformed");
			}
			return { id: payload.id, name: payload.name.trim() };
		});
}
