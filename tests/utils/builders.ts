// Public API of the utils folder.
export const exportedBuild = (input: { id: string; name: string; tags: string[] }) => {
	const tags = input.tags.filter((t) => t.length > 0);
	if (tags.length === 0) return null;
	return {
		resourceType: "Thing",
		id: input.id,
		name: input.name,
		tagCount: tags.length,
	};
};

// Private internal helper — must NOT be a canonical reuse target.
// Deliberately NOT exported. Structurally identical to the app builder below.
const privateBuild = (input: { id: string; name: string; tags: string[] }) => ({
	resourceType: "Thing",
	id: input.id,
	name: input.name,
	tags: input.tags,
});

// Reference it so the fixture is self-consistent (unused otherwise).
void privateBuild;
