// Anonymous callbacks whose bodies are valueless one-liners. They score as
// trash BODIES (a single field compared against a literal), but the inline
// recommendation does not apply to an anonymous callback — there is nothing to
// inline. The matcher must still see the two callbacks as mutual copies (worth
// moving); the trash filter must NOT route them to the Trash section.
type Entry = { count: number };

export const checkQueueA = (queue: Entry[]): boolean => queue.some((item) => item.count === 1);

export const checkQueueB = (queue: Entry[]): boolean => queue.some((item) => item.count === 1);
