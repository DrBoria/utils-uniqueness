"use strict";

// Assemble the ONE JSON payload the overview renders. Everything the browser
// needs is computed here: the findings, their numbers, the real source of both
// sides, the line/word diff and the nested callee diffs. The React bundle stays
// dumb, and the HTML file is self-contained — openable from disk, no server, no
// network, no sidecar files.

const path = require("node:path");
const pkg = require("../../../package.json");
const { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } = require("../../../decision-maker");

const { describeComp } = require("../../errorTypes");
const { findingText } = require("../../cli-report");
const { SIGNALS } = require("../../errorTypes/vocabulary/labels");
const { buildGroups } = require("./groups");
const { buildFolders } = require("./folders");
const { buildIndex, expansionsFor } = require("./calls");
const source = require("./source");
const diff = require("./diff");
const { annotate } = require("./annotate");
const { analyze } = require("../../matchers");
const { percentOf, MIN_CORRESPONDENCE } = require("../../../evidence");
const { alignSteps, weightsOf } = require("../../../matcher/control-flow");
const { sitesByKind } = require("../../../normalize/tree");
const { countLabel, countOf } = require("../../matchers/structure/count");
const { wordOf } = require("./word");
const { FLOW_KINDS, flowRarity, flowWord } = require("../../../constants");
const { declarationOf } = require("../../matchers/signature/declaration");
const { KIND, ROW, MAX_EXPANSIONS_PER_PAIR, EXPANSION_MIN_CONFIDENCE, STRUCTURAL_KINDS } = require("../../../constants");

// A filtered-out pair is informational: the decision panel explains why, and a
// side-by-side of rows a filter has already dismissed would only inflate the
// page.
const DIFFABLE = new Set([KIND.Duplicate, KIND.Similar, KIND.Part]);

const abs = (repoRoot, relPath) => (path.isAbsolute(relPath) ? relPath : path.resolve(repoRoot, relPath));

const spanForPlace = (repoRoot, item) => {
	if (!item || !item.path) return null;
	const lines = source.spanOf(abs(repoRoot, item.path), item.line, item.endLine ?? item.line);

	return { ...item, startLine: lines.startLine, endLine: lines.endLine, lines: lines.lines, missing: lines.missing };
};

const annotateRows = (list) => annotate(list);

// One pair = one diff. The two sides are resolved from the finding's places;
// when a side has no line (a canonical named only by path) the function index
// supplies it.
//
// The payload carries the CODE ONCE: the rows hold the text, so a side is only
// `{ name, path, startLine, endLine }`. Keeping a second copy of every line made
// a real run's page 35 MB, most of it the same characters twice.
const side = (span) => ({ name: span.name ?? null, path: span.path, line: span.line ?? span.startLine, startLine: span.startLine, endLine: span.endLine });

// A nested callee diff is evidence, not the finding: four of them already prove
// the sameness continues, and a pair that is barely similar does not deserve
// any.


// The candidate two of the graphics draw: matched by `path#name`, because a
// finding names a place, and the candidate holds the parsed tree of that place.
const candidateOf = (byKey, place) => {
	if (!place) return null;

	return byKey.get(`${place.path}#${place.name}`) ?? null;
};

const buildPair = ({ finding, index, repoRoot, candidates }) => {
	const left = spanForPlace(repoRoot, finding.left);
	let rightPlace = finding.right;
	if (rightPlace && rightPlace.path && !rightPlace.line) {
		const entry = index.get(rightPlace.path)?.get(rightPlace.name);
		if (entry) rightPlace = { ...rightPlace, line: entry.line, endLine: entry.endLine };
	}
	const right = spanForPlace(repoRoot, rightPlace);
	if (!left || !right || left.missing || right.missing) return null;

	const compared = diff.diffSpans({ startLine: left.startLine, lines: left.lines }, { startLine: right.startLine, lines: right.lines });
	const annotated = annotateRows(compared.rows);
	// The pair's cells exposed GENERICALLY: a row carries `cells: [...]` in column
	// order, and the pair carries `columns: [{path}, …]`. This is the only place the
	// 2-column source schema (`left`/`right`) is known; everything downstream —
	// the adapter and code-diff — addresses columns by INDEX ("0","1",…).
	const withCells = (row) =>
		row.type === "fold" && Array.isArray(row.rows) ? { ...row, rows: row.rows.map(withCells) } : { ...row, cells: [row.left, row.right] };
	const columns = [{ path: finding.left.path }, { path: finding.right?.path }];
	// Which part of the declaration each row is — named here, once, so the page
	// prints a label instead of inventing one from the row text.
	//
	// ONLY the declaration is labelled. `try`, `const`, `return` are the STRUCTURE
	// matcher's business, and putting them in this list mixed two groups inside
	// one tab: the signature scores parameter roles, the return kind and the name
	// words — it never looks at a `try`.
	const texts = (pick) => annotated.rows.map((row) => (row[pick]?.words ? row[pick].words.map((word) => word.text).join("") : (row[pick]?.text ?? "")));
	const declaration = declarationOf({ left: texts("left"), right: texts("right") });
	const wanted = (finding.confidence ?? 0) >= EXPANSION_MIN_CONFIDENCE ? MAX_EXPANSIONS_PER_PAIR : 0;
	const analysis = analyze(candidateOf(candidates, finding.left), candidateOf(candidates, finding.right));

	// STRUCTURE and CONTROL FLOW also get lanes: a lane per kind of node that both
	// sides write on some line. Structure reads every kind of the body, control flow
	// only its own vocabulary (branches, loops, returns, calls) — the two groups keep
	// their own questions, and both now address ROWS instead of only scoring them.
	const lanesOf = (leftCandidate, rightCandidate, filter, group) => {
		if (!leftCandidate?.tree || !rightCandidate?.tree) return [];
		// WHERE a construct is written comes from the TREE, not from the text: the node
		// carries its line and its 1-based column, so a lane names the same position the
		// parser named. Nothing here searches a line for a word — one vocabulary, one
		// answer, the same for every kind of node.
		const lineTexts = [0, 1].map((column) => {
			const map = new Map();
			// A cell is either plain `text` or a word diff (`words`); both expose the text.
			const textOfCell = (cell) => (cell == null ? "" : cell.words ? cell.words.map((word) => word.text).join("") : (cell.text ?? ""));
			for (const row of annotated.rows) {
				const cell = row.cells?.[column] ?? (column === 0 ? row.left : row.right);
				if (cell && cell.no != null) map.set(String(cell.no), textOfCell(cell));
			}

			return map;
		});
		// The width of the token that STARTS at the node's column — how many characters
		// the reader sees under the mark. Measured from the known position, never found
		// by scanning the line: `const` is 5 characters because it starts there.
		const widthAt = (column, line, at) => {
			if (at == null) return null;
			const text = (lineTexts[column].get(line) ?? "").slice(at - 1);
			const token = /^(?:[A-Za-z_$][\w$]*|=>|\?|\.\.\.)/.exec(text);
			if (token) return token[0].length;

			return 1;
		};

		// WHICH occurrences correspond. Every kind pairs the k-th with the k-th: the
		// construct is the same construct whatever it is named, and the NUMBERING beside it
		// does exactly the same — a step that gets a number must get a lane, or the board
		// numbers a correspondence it does not draw.
		const pairsOf = (kind, left, right) => {
			const count = Math.min(left.length, right.length);

			return Array.from({ length: count }, (_, index) => [left[index], right[index]]);
		};

		const leftSites = sitesByKind(leftCandidate.tree, filter);
		const rightSites = sitesByKind(rightCandidate.tree, filter);
		// ONE SITE PER LINE: two nodes of a kind can start on the same line, and a lane
		// addresses a ROW. Counting the second one shifted the pairs.
		const byLine = (sites) => {
			const seen = new Map();
			for (const site of [...(sites ?? [])].sort((a, b) => a.line - b.line)) {
				const kept = seen.get(site.line);
				if (kept === undefined) seen.set(site.line, site);
				else if (kept.column === null && site.column !== null) seen.set(site.line, site);
			}

			return [...seen.values()].sort((a, b) => a.line - b.line);
		};
		const lanes = [];
		// TWO QUESTIONS, TWO SHAPES.
		//
		// STRUCTURE asks HOW MANY: one lane per kind, `call · 5/7 · 71%`, one rope over
		// the whole block of rows on each side.
		//
		// CONTROL FLOW asks IN WHAT ORDER: the SAME entities row by row, one lane per
		// step — the k-th `if` to the k-th `if`. Merging them here would destroy the
		// only thing this group is about.
		const perStep = group === "controlFlow";

		for (const kind of new Set([...leftSites.keys(), ...rightSites.keys()])) {
			const leftItems = byLine(leftSites.get(kind));
			const rightItems = byLine(rightSites.get(kind));
			const paired = pairsOf(kind, leftItems, rightItems);
			if (paired.length === 0) continue;

			const marksOf = (site, index) => {
				if (site.column === null) return [];
				const line = String(site.line);
				if (kind === "var-destr") {
					// BOTH braces: the opening one on the row the pattern starts, the closing one
					// on the row it ends — a pattern is often written over several lines.
					const braces = [{ column: index, line, from: site.column - 1, to: site.column }];
					if (typeof site.columnEnd === "number") {
						braces.push({ column: index, line: String(site.endLine ?? site.line), from: site.columnEnd - 1, to: site.columnEnd });
					}

					return braces;
				}
				const width = widthAt(Number(index), line, site.column);
				if (width === null) return [];
				const to = typeof site.columnEnd === "number" ? site.columnEnd : site.column - 1 + width;

				return [{ column: index, line, from: site.column - 1, to }];
			};

			if (perStep) {
				// A declaration lane is NAMED by its keyword: `const`, `let`, `var` are three
				// different constructs, so the caption says which one and not `var:const`.
				// A step is matched or not — there is no share to print.
				const word = flowWord(kind);
				for (const [at, [leftSite, rightSite]] of paired.entries()) {
					lanes.push({
						connectionId: `${group}:${kind}:${at + 1}`,
						label: word,
						ends: [
							{ column: "0", items: [String(leftSite.line)] },
							{ column: "1", items: [String(rightSite.line)] },
						],
						marks: [...marksOf(leftSite, "0"), ...marksOf(rightSite, "1")],
					});
				}
				continue;
			}

			// A kind below half is not a correspondence: it is neither drawn nor counted.
			if (countOf(leftItems.length, rightItems.length).share < MIN_CORRESPONDENCE) continue;

			lanes.push({
				connectionId: `${group}:${kind}:1`,
				// The caption is the piece, and its share ONLY when it differs: `call · 38%`,
				// plain `call` at an exact match. One source for the board and the CLI.
				label: countLabel(flowWord(kind), leftItems.length, rightItems.length),
				ends: [
					{ column: "0", items: paired.map(([left]) => String(left.line)) },
					{ column: "1", items: paired.map(([, right]) => String(right.line)) },
				],
				marks: paired.flatMap(([left, right]) => [...marksOf(left, "0"), ...marksOf(right, "1")]),
			});
		}

		return lanes;
	};
	const leftCandidate = candidateOf(candidates, finding.left);
	const rightCandidate = candidateOf(candidates, finding.right);
	// STRUCTURE is about CONSTRUCTS: a branch, a loop, a `try`, a call, a declaration.
	// Identifiers, properties, literals and operators are the AST group's material, and
	// naming them here only painted the same words the signature group already paints.
	// `var-decl` is NOT listed: the declarator lives inside the `var` statement and starts
	// on the same row, so a lane for it said the same thing twice. A destructuring
	// declaration is its own kind (`var-destr`) and gets its own lane and its own %.
	const STRUCTURE_KINDS = new Set([...FLOW_KINDS, ...STRUCTURAL_KINDS, "func"]);
	const structureConnections = lanesOf(leftCandidate, rightCandidate, STRUCTURE_KINDS, "structure");
	const controlFlowConnections = lanesOf(leftCandidate, rightCandidate, FLOW_KINDS, "controlFlow");

	// ── NOTES ────────────────────────────────────────────────────────────────
	//
	// A bare NUMBER, pinned with a RELATIVE position above the row — never a column
	// of its own in the middle of the board. The number stands over the place it
	// counts:
	//   Structure    — how many ARGUMENTS the call passes, over its argument list:
	//                  `1` over `f(a)`, `2` over `f(a, b)`.
	//   Control flow — the number of the STEP, over the row it starts on.
	// Tabs are INDENTATION: one character in the line, several columns on screen. A note
	// or a mark is addressed by a COLUMN, so an index is expanded to the columns the row
	// really occupies (the board renders a tab as 2 columns).
	const TAB = 2;
	const textOfCell = (cell) => (cell == null ? "" : cell.words ? cell.words.map((word) => word.text).join("") : (cell.text ?? ""));
	const lineTexts = [0, 1].map((column) => {
		const map = new Map();
		for (const row of annotated.rows) {
			const cell = row.cells?.[column] ?? (column === 0 ? row.left : row.right);
			if (cell && cell.no != null) map.set(String(cell.no), textOfCell(cell));
		}

		return map;
	});
	const columnOfIndex = (text, index) => {
		let column = 0;
		for (let at = 0; at < index && at < text.length; at += 1) column += text[at] === "\t" ? TAB : 1;

		return column;
	};
	const notesOf = () => {
		const empty = () => ({ 0: {}, 1: {} });
		const structure = empty();
		const controlFlow = empty();
		for (const [candidate, column] of [[leftCandidate, 0], [rightCandidate, 1]]) {
			const calls = candidate?.tree ? sitesByKind(candidate.tree, new Set(["call"])).get("call") ?? [] : [];
			for (const site of calls) {
				if (site.column === null || site.column === undefined) continue;
				// Only a call that actually PASSES something: `f()` and `f(a)` say nothing a
				// number could add, so the number appears from two arguments up.
				if ((site.arity ?? 0) <= 1) continue;
				const line = String(site.line);
				const list = structure[column][line] ?? [];
				list.push({
					from: columnOfIndex(lineTexts[column].get(line) ?? "", site.column - 1),
					text: String(site.arity),
					title: `${site.arity} arguments passed`,
				});
				structure[column][line] = list;
			}
			// Control flow has NO number above a row: its numbering is ONE column in the
			// middle of the board (`flowNumbers`), so a per-row copy would be a second
			// numbering of the same thing.
		}

		return { structure, controlFlow };
	};
	const notes = notesOf();

	// ── THE ORDER OF THE RUN ─────────────────────────────────────────────────
	//
	// The COUNTER of control flow is how many steps are common CONSECUTIVELY: `const`,
	// `new`, `if`, `try` written exactly the same way, one after another, on both sides.
	// So the numbering covers the common run and stops at the first step that does not
	// match — a step that only one side has gives neither a number nor a ribbon.
	const flowNumbers = (() => {
		const stepsOf = (candidate) => [...(candidate?.controlFlow?.sequenceSites ?? [])].sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
		const leftSteps = stepsOf(leftCandidate);
		const rightSteps = stepsOf(rightCandidate);
		// THE SAME WALK THE SCORE USES (`alignSteps`), WITH THE SAME RARITY WEIGHTS: a
		// numbered step is a counted step, and a rare step anchors the run before a
		// frequent one — `if`/`return` ahead of `var`/`call`.
		const keyOf = (step) => `${step.path}/${step.kind}`;
		const leftKeys = leftSteps.map(keyOf);
		const rightKeys = rightSteps.map(keyOf);
		const pairs = alignSteps(leftKeys, rightKeys, weightsOf(leftKeys, rightKeys));
		return pairs.map(([at, other], index) => {
			const step = leftSteps[at];
			const twin = rightSteps[other];

			return {
				id: `s:${step.line}:${index}`,
				text: String(index + 1),
				// The MIDDLE column prints this: a declaration shows its keyword.
				kind: flowWord(step.kind),
				left: String(step.line),
				right: String(twin.line),
				leftStep: step,
				rightStep: twin,
			};
		});
	})();

	// WHICH token each step IS (`if`, `try`, `call`…), per row and column. Control flow
	// draws no lanes, so these ranges are the only thing that says where a step sits.
	const flowMarks = (() => {
		const out = { 0: {}, 1: {} };
		// The mark is the WHOLE construct the step is: `const` … `;`, `{` … `}` for a
		// destructuring pattern, the argument list of a call. A construct written over
		// several rows has TWO ends, each marked on its own row — a range cannot cross a row.
		const add = (column, line, from, to) => {
			if (line === null || from === null) return;
			const text = lineTexts[column].get(String(line)) ?? "";
			const end = Math.min(to, text.length);
			if (end <= from) return;
			const list = out[column][String(line)] ?? [];
			list.push({ from, to: end });
			out[column][String(line)] = list;
		};
		const markOf = (site, column) => {
			if (!site || site.column === null || site.column === undefined) return;
			const line = String(site.line);
			// A mark is a CHARACTER RANGE inside the row text, and the text still carries its
			// tabs: the parser counts a tab as one character, so the mark is written with the
			// same count. Expanding tabs here shifted every mark one character right — that is
			// where `onst`, `ew` and `f` came from.
			const from = site.column - 1;
			// Multi-row construct: the opening token here, the closing token there.
			if (typeof site.endLine === "number" && String(site.endLine) !== line && typeof site.columnEnd === "number") {
				const endLine = String(site.endLine);
				add(column, line, from, from + 1);
				add(column, endLine, site.columnEnd - 1, site.columnEnd);

				return;
			}
			const to = typeof site.columnEnd === "number" ? site.columnEnd : from + 1;
			add(column, line, from, to);
		};
		for (const row of flowNumbers) {
			markOf(row.leftStep, 0);
			markOf(row.rightStep, 1);
		}

		return out;
	})();
	// Name sites by COLUMN index, not by a left/right key. The data says only WHICH
	// id belongs to WHICH connection: a connectionId plus the ids of each column.
	// Nothing here groups ids, splits runs or knows how many rows a block covers —
	// that is the view's business. The words for a kind come with each site, from
	// the syntax kind that produced it — there is no table to keep in sync.
	const names = analysis?.signature?.names;
	const connections = [];
	// WHICH ROWS BREAK a lane, per column: `differs` on the row, `same` (absent) on
	// the rest of it. The row's own tone, so the board paints it without being told
	// about a second list of ids.
	let rowTones = [];
	if (names) {
		names.byColumn = [names.sites?.left ?? [], names.sites?.right ?? []];
		// Shared words of each function name, WITH their columns. Always an array;
		// one name can contribute 1 word, or several.
		names.byColumnWords = [names.wordSites?.left ?? [], names.wordSites?.right ?? []];

		// connectionId → column → ids of the places that declare a shared name.
		// EVERY place the name is written is an id, not just the first one: a name used
		// twice (`type:` in two entries of the same array) is the same name twice, and
		// dropping the second occurrence hid a whole matched block.
		//
		// The label states WHAT the rows are AND what this category gives the verdict — the
		// same arithmetic the matcher uses, so a caption never promises a share the score
		// does not count. A site without a label (a key read from the tree) must not turn
		// `property assignments` into `prop`.
		const siteBag = (column, kind) => {
			const bag = new Map();
			for (const site of names.byColumn[column] ?? []) {
				if (site.kind !== kind || site.line == null) continue;
				bag.set(site.name, (bag.get(site.name) ?? 0) + 1);
			}

			return bag;
		};
		// A name is still paired with its twin — `actionName` never joins `cb` — but
		// `historyCapacity` and `changeLogCapacity` are written one under the other, so
		// they are ONE block, not two lanes with the same caption. Two blocks with rows
		// between them (44–45 and 52–54 here) stay two: the gap is the difference.
		const named = [];
		// WHICH NAMES ACTUALLY GOT A LANE. A name both sides declare is not the same thing as
		// a name both sides declare AS THE SAME KIND: `entries` is a property on one side and
		// a parameter on the other, so it has no lane — and painting it was a match the board
		// claimed without drawing it.
		const matchedNames = new Set();
		for (const name of names.common) {
			const perColumn = names.byColumn.map((sites) => (sites ?? []).filter((site) => site.name === name && site.line != null));
			if (perColumn.some((sites) => sites.length === 0)) continue;
			// The category both sides declare the name as — `parameters`, `variable declarations`.
			const kinds = [...new Set(perColumn[0].map((site) => site.kind).filter((kind) => perColumn.every((sites) => sites.some((site) => site.kind === kind))))];
			for (const kind of kinds) {
				const ends = perColumn.map((sites, column) => ({
					column: String(column),
					items: [...new Set(sites.filter((site) => site.kind === kind).map((site) => String(site.line)))].sort((a, b) => Number(a) - Number(b)),
				}));
				if (ends.some((end) => end.items.length === 0)) continue;
				// The label says WHAT the rows are — a site without one (a key read from the
				// tree) must not turn `property assignments` into `prop`. The PERCENT is not
				// computed here: it belongs to the lane it is printed on, never to the category.
				const text = perColumn.flat().find((site) => site.kind === kind && site.label)?.label ?? kind;
				named.push({ connectionId: `same:${kind}:${name}`, kind, text, name, ends });
				matchedNames.add(name);
			}
		}
		// Row order, so "next to" means what the reader sees, not the alphabet.
		named.sort((a, b) => Number(a.ends[0].items[0]) - Number(b.ends[0].items[0]));
		// WHERE a correspondence is BROKEN, per kind and per column: the occurrences one
		// side declares and the other does not (`pixels` in a parameter list). They are part
		// of the SAME lane — a lane's percent is matched/total, so the rows that make up the
		// denominator have to be on the board — and they are painted `differs`.
		const orphansOf = (kind) => {
			const byColumn = new Map();
			for (let column = 0; column < names.byColumn.length; column += 1) {
				const perName = new Map();
				for (const site of names.byColumn[column] ?? []) {
					if (site.kind !== kind || site.line == null) continue;
					const list = perName.get(site.name) ?? [];
					list.push(Number(site.line));
					perName.set(site.name, list);
				}
				byColumn.set(column, perName);
			}
			// The occurrences BEYOND what the other side has: the surplus is the break.
			const lines = new Map();
			for (const [column, perName] of byColumn) {
				const broken = new Map();
				for (const [name, where] of perName) {
					const twin = byColumn.get(names.byColumn.length - 1 - column)?.get(name) ?? [];
					if (where.length <= twin.length) continue;
					for (const line of [...where].sort((a, b) => a - b).slice(twin.length)) broken.set(line, name);
				}
				lines.set(column, broken);
			}

			return lines;
		};
		// The same place the board paints it: the row that breaks the lane.
		rowTones = names.byColumn.map(() => ({}));
		// ONE PASS PER CATEGORY: `property assignments` on one row are the same block even
		// when a `variable declarations` lane is written on that very row between them.
		const byText = new Map();
		for (const lane of named) {
			const list = byText.get(lane.text) ?? [];
			list.push(lane);
			byText.set(lane.text, list);
		}
		const glued = [];
		for (const lanes of byText.values()) {
			const runs = [];
			const orphans = orphansOf(lanes[0]?.kind);
			for (const lane of lanes) {
				const last = runs[runs.length - 1];
				const joins =
					last !== undefined &&
					lane.ends.every((end, at) => {
						const previous = last.ends[at];
						if (previous === undefined) return false;
						const from = Math.max(...previous.items.map(Number));
						const to = Math.min(...end.items.map(Number));
						if (to - from <= 1) return true;
						// A gap is only a BREAK of the block when nothing but the rows that break the
						// correspondence sits in it — then it is still ONE lane, and the reader sees why
						// the lane is not 100%.
						const lines = orphans.get(Number(end.column)) ?? new Map();
						for (let line = from + 1; line < to; line += 1) if (!lines.has(line)) return false;

						return true;
					});
				if (!joins) {
					runs.push({ connectionId: lane.connectionId, kind: lane.kind, text: lane.text, names: new Set([lane.name]), ends: lane.ends.map((end) => ({ column: end.column, items: [...end.items] })) });
					continue;
				}
				last.names.add(lane.name);
				last.ends = last.ends.map((end, at) => ({
					column: end.column,
					items: [...new Set([...end.items, ...lane.ends[at].items])].sort((a, b) => Number(a) - Number(b)),
				}));
			}
			glued.push(...runs);
		}
		// THE BREAKS JOIN THE LANE THEY BELONG TO — the rows between its matches, painted
		// `differs`, so the lane's percent can be checked on the board and not only trusted.
		for (const lane of glued) {
			if (lane.kind === undefined) continue;
			const orphans = orphansOf(lane.kind);
			lane.ends = lane.ends.map((end) => {
				const column = Number(end.column);
				const numbers = end.items.map(Number).filter((number) => Number.isFinite(number));
				if (numbers.length === 0) return end;
				const from = Math.min(...numbers);
				const to = Math.max(...numbers);
				const extra = [];
				for (const [line, name] of orphans.get(column) ?? []) {
					if (line < from || line > to) continue;
					extra.push(String(line));
					lane.names.add(name);
				}
				for (const id of extra) rowTones[column][Number(id)] = "differs";

				return { column: end.column, items: [...new Set([...end.items, ...extra])].sort((a, b) => Number(a) - Number(b)) };
			});
			// THE LANE'S OWN NUMBER: the share of what this lane shows. A lane of one name that
			// matched is 100% and prints nothing — the category's share is not its business.
			const leftBag = siteBag(0, lane.kind);
			const rightBag = siteBag(1, lane.kind);
			let matched = 0;
			let total = 0;
			for (const name of lane.names) {
				matched += Math.min(leftBag.get(name) ?? 0, rightBag.get(name) ?? 0);
				total += Math.max(leftBag.get(name) ?? 0, rightBag.get(name) ?? 0);
			}
			const share = total === 0 ? 1 : matched / total;
			// The caption names the piece in the NUMBER it has: one row is one `parameter`,
			// one shared name is one `function name`.
			const text = wordOf(lane.text, lane.names.size);
			lane.label = share >= 1 ? text : `${text} · ${percentOf(share)}%`;
		}
		glued.sort((a, b) => Number(a.ends[0].items[0]) - Number(b.ends[0].items[0]));
		connections.push(...glued);
		// The view paints a name because the DATA says it has a lane, never because it happens
		// to sit on a row some other lane selected.
		names.matched = [...matchedNames];

		// THE FUNCTION NAME ITSELF, word by word. `createPlainAdapter` and
		// `createDifficultAdapter` share `create` and `Adapter` — that is a partial
		// match, so the two rows are ONE lane and only the words both names have are
		// painted (the view paints `wordSites` by column, never by searching the text).
		const wordLines = (sites) => [...new Set((sites ?? []).filter((word) => word.line != null).map((word) => String(word.line)))].sort((a, b) => Number(a) - Number(b));
		const leftWords = wordLines(names.wordSites?.left);
		const rightWords = wordLines(names.wordSites?.right);
		if (names.words?.common?.length > 0 && leftWords.length > 0 && rightWords.length > 0) {
			const words = Math.max(names.words.left.length, names.words.right.length);
			const share = words === 0 ? 0 : names.words.common.length / words;
			connections.push({
				connectionId: "same:name-word",
				// The names correspond word for word — no number. A partial one prints its
				// intersection, never `2/3`. It is ONE name on each side, so the caption says
				// `function name`.
				label: (() => {
					const text = wordOf("function names", 1);

					return share >= 1 ? text : `${text} · ${percentOf(share)}%`;
				})(),
				ends: [
					{ column: "0", items: leftWords },
					{ column: "1", items: rightWords },
				],
			});
		}

		// The RETURN itself. A name says which keys an object has; it says nothing about
		// handing that object back. The two `return` lines are the same value and belong
		// together, so they are a connection like any other.
		const returns = analysis?.signature?.returnValues;
		if (returns && returns.pairs.length > 0) {
			const same = returns.pairs.filter((pair) => pair.same);
			// A lane EXISTS only for a value both sides hand back. Two different returns are
			// evidence of the opposite, and drawing a ribbon at 0% claimed a correspondence
			// that is not there.
			if (same.length > 0) {
				const ends = [
					{ column: "0", items: same.map((pair) => String(pair.left.line)).filter((id) => id !== "null") },
					{ column: "1", items: same.map((pair) => String(pair.right.line)).filter((id) => id !== "null") },
				];
				if (ends.every((end) => end.items.length > 0)) {
					// The lane's number is the CORRESPONDENCE of the returns — the same shape is
					// 100% and prints nothing, a partial one prints its share. An evidence
					// coefficient here read as "36% similar" over identical returns.
					const share = same.length / returns.pairs.length;
					const text = wordOf("returns", same.length);
					connections.push({ connectionId: "same:return", label: share >= 1 ? text : `${text} · ${percentOf(share)}%`, ends });
				}
			}
		}
	}
	const leftText = left.lines.map((l) => l.text).join("\n");	const expansions = wanted
		? expansionsFor({ leftPath: finding.left.path, rightPath: finding.right?.path, leftText, index, source, repoRoot, diff })
				.slice(0, wanted)
				.map((ex) => ({ name: ex.name, identical: ex.identical, counts: ex.counts, left: side(ex.left), right: side(ex.right), rows: annotateRows(ex.rows).rows.map(withCells) }))
		: [];

	// THE CONSOLE BLOCK for this finding, verbatim: the same string `cli-report`
	// prints there, rendered here. One function, one block — nothing reassembled.
	const cli = findingText(finding, candidates);

	return {
		findingId: finding.id,
		kind: finding.kind,
		// id → connectionId, and nothing else.
		connections,
		// The same for the other two groups: their own lanes, by their own question.
		structureConnections,
		controlFlowConnections,
		// The numbers pinned above the rows, per tab and per column: a relative
		// position inside the row, never a column of its own.
		notes,
		// Control flow's ONE numbering, in the middle of the board: the run is the same
		// on both sides, so the step number is written once.
		flowNumbers,
		// The token that IS each step, per row: the flow draws no lanes, only these.
		flowMarks,
		// Where a lane is not 100%: the row that breaks it, by column and id.
		rowTones,
		columns,
		left: side(left),
		right: side(right),
		rows: annotated.rows.map(withCells),
		counts: compared.counts,
		// How many rows each group can / cannot tell apart — the number the
		// header shows next to the group's score, so a 0.12 is two green rows
		// out of eleven, not a mystery.
		marks: annotated.counts,
		// The picture behind each score: signature / structure / flow / AST.
		analysis,
		cli,
		// Name → rows. The signature tab draws these and nothing it made up.
		declaration,
		expansions,
	};
};

const countBy = (findings, key) => {
	const map = new Map();
	for (const finding of findings) map.set(finding[key], (map.get(finding[key]) ?? 0) + 1);

	return [...map.entries()].map(([value, count]) => ({ value, count }));
};

const collectOverviewData = ({ comp, repoRoot, config = {}, catalogPath = null, notices = [], generatedAt }) => {
	const findings = comp.findings ?? describeComp(comp);
	const index = buildIndex([...(comp.appUtils ?? []), ...(comp.canonUtils ?? [])]);
	const candidates = new Map(
		[...(comp.appUtils ?? []), ...(comp.canonUtils ?? [])].map((candidate) => [`${candidate.path}#${candidate.name}`, candidate]),
	);

	const pairs = [];
	const pairsById = new Map();
	for (const finding of findings) {
		if (!DIFFABLE.has(finding.kind)) continue;
		const pair = buildPair({ finding, index, repoRoot, candidates });
		if (!pair) continue;
		pairs.push(pair);
		pairsById.set(finding.id, pair.findingId);
	}
	const withPair = findings.map((finding) => ({ ...finding, hasPair: pairsById.has(finding.id) }));
	// Findings are ordered by OVERALL confidence, highest first (1.00 at the top,
	// the weakest at the bottom) — the same order every screen inherits.
	withPair.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

	const groups = buildGroups(withPair);
	const folders = buildFolders(withPair);
	const folderCount = (node) => 1 + node.children.reduce((sum, child) => sum + folderCount(child), 0);
	const roots = new Set(findings.map((f) => (f.left?.path ?? "").split("/")[0]).filter(Boolean));
	// The formula the verdict uses, with the engine's defaults filled in when the
	// consumer's config does not override them: the page explains the real numbers.
	const weights = { ...DEFAULT_WEIGHTS, ...(config.weights ?? {}) };
	const thresholds = { ...DEFAULT_THRESHOLDS, ...(config.thresholds ?? {}) };

	return {
		meta: {
			tool: pkg.name,
			version: pkg.version,
			repoRoot,
			repoName: path.basename(repoRoot),
			generatedAt: generatedAt ?? new Date().toISOString(),
			catalogPath: catalogPath ? path.relative(repoRoot, catalogPath) : null,
			utilsFolder: config.utilsFolder ?? [],
			weights,
			thresholds,
			filesScanned: comp.files ?? 0,
			canonCount: comp.canonCount ?? 0,
			appCount: comp.appCount ?? 0,
			roots: [...roots],
			// What the run could NOT read. A caveat, not a finding: it is shown as
			// a banner on every screen so a partial answer is never read as a full
			// one.
			notices,
		},
		stats: {
			findings: withPair.length,
			duplicates: withPair.filter((f) => f.kind === KIND.Duplicate).length,
			similar: withPair.filter((f) => f.kind === KIND.Similar).length,
			parts: withPair.filter((f) => f.kind === KIND.Part).length,
			missing: withPair.filter((f) => f.kind === KIND.Missing).length,
			clusters: withPair.filter((f) => f.kind === KIND.Cluster).length,
			trash: withPair.filter((f) => f.kind === KIND.Trash).length,
			dropped: withPair.filter((f) => f.kind === KIND.Dropped).length,
			pairs: pairs.length,
			groups: groups.length,
			folders: folderCount(folders),
		},
		byKind: countBy(withPair, "kind"),
		// The legend the page prints: one entry per comparison group, with the
		// colour that group uses in every bar and highlighted row.
		signals: SIGNALS.map((s) => ({ key: s.key, label: s.label, short: s.short, color: s.color, what: s.what })),
		findings: withPair,
		pairs,
		groups,
		folders,
		decisions: { weights, thresholds },
		utilsFolder: config.utilsFolder ?? [],
	};
};

module.exports = { collectOverviewData, spanForPlace, annotateRows };
