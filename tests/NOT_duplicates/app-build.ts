// Structurally identical to the PRIVATE canonical `privateBuild`
// (return object literal with the same 4 properties).
// It is NOT a duplicate of the exported `exportedBuild` (which has a guard,
// a filter, and a different property set).
export const appBuild = (input: { id: string; name: string; tags: string[] }) => ({
	resourceType: "Thing",
	id: input.id,
	name: input.name,
	tags: input.tags,
});
