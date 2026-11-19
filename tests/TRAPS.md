# Adversarial traps — utils-uniqueness round (u01–u18)

Author: trap-author agent. Engine under test: `utils-uniqueness` (function-level
duplicate detection). Canon side = `tests/NOT_duplicates`, app side = `tests/duplicates`. Every trap
pair has one function in each side; app↔app pairs are never reported, so none of
these rely on that. Smoke traps (`smoke-1`, `smoke-2`) are kept untouched.

Legend: **expect** is the verdict the manifest demands from the detector for the
listed pair (`duplicate` ≥ 0.75, `similar` ≥ 0.65, `none` below similar).

| id | mechanism | expect | one-line description |
|----|-----------|--------|----------------------|
| u01 | inline helpers' bodies + template→concat | duplicate | `formatCurrency` inlines `formatMoney`'s two helper calls and concatenates instead of templating |
| u02 | parameterized copy (names + literals) | duplicate | `sliceWindow` = `paginate` with all names changed and cap 100→50 |
| u03 | same contract, different algorithm (NEG) | none | `linearSearch` vs `binarySearch`: identical signature/contract, O(n) vs O(log n) |
| u04 | reduce → for-loop rewrite | similar | `forWeightedMean` turns the reduce accumulator object into two mutable lets |
| u05 | early-return guards → nested ifs | duplicate | `nestedPasswordScore` nests the two guards of `passwordStrength` |
| u06 | if/else chain → ternary chain | duplicate | `statusCategory` folds `httpStatusKind`'s branches into nested ternaries |
| u07 | plain params → destructured defaults | duplicate | `joinDelimited` moves `joinCsv`'s in-body defaults into destructured option defaults |
| u08 | same domain, different algorithm (NEG) | none | `mergePairs` (zip arrays) vs `deepMerge` (recursive record merge) |
| u09 | async/await → .then chain | duplicate | `fetchUserById` chains the exact fetch/validate/project steps of `loadUser` |
| u10 | try/catch+throw → .catch+error object | similar | `readSettings` rewraps `parseSettings` as a promise returning `{ok,value,error}` |
| u11 | shared boilerplate shell, different core (NEG) | none | `computeShipping` copies `computeTax`'s shell but computes shipping, not tax |
| u12 | inverse operation (NEG) | none | `formatQueryString` is the record→string inverse of `parseQueryString` |
| u13 | string clamp vs numeric clamp skeleton (NEG) | none | `snapToGrid` mirrors `truncateText`'s clamp shape but uses modulo math on numbers |
| u14 | recursion → explicit stack | similar | `flattenIterative` replaces `deepFlatten`'s recursion with a reversed LIFO stack |
| u15 | named helpers + reordered pipeline | duplicate | `tallyPaidOrders` names the arrows and swaps filter/map of `summarizeOrders` |
| u16 | reordered lets + spread assembly | duplicate | `makeProfile` reorders `buildUserProfile`'s consts and spreads a partial base |
| u17 | one function split into two | similar | `cleanRecord` + `formatGrade` combined equal `processRecord`; `cleanRecord` is the graded half |
| u18 | mirror-image loop (invention) | duplicate | `isNonDecreasing` scans backwards with flipped comparison vs `isSortedAscending` |

Negatives: u03, u08, u11, u12, u13 (5). Positives marked `similar` because the
mechanism genuinely dilutes the signal: u04, u10, u14, u17. All other positives
demand `duplicate`.

## Author's intent per trap

### u01 — duplicate THROUGH calls
`formatMoney` delegates rounding and digit-grouping to two exported helpers;
`formatCurrency` inlines both bodies verbatim and replaces the template literals
with `+` concatenation. The call graph differs (two calls disappear) and the
final expression kind changes, but every computation survives. A detector that
only compares call sites or raw AST kinds will miss it; one that normalizes
inlined helper bodies should catch it.

### u02 — parameterized copy
Pure renaming is proven too easy by smoke-1, so this copy also changes a
semantic-looking literal (per-page cap 100 → 50) and renames every returned
property key. Structure, control flow and statement order are identical. Tests
whether normalization extends beyond identifiers to small literal deltas.

### u03 — NEGATIVE: same contract, different algorithm
`linearSearch` and `binarySearch` share the exact signature
`(number[], number) => number`, the same domain, and the same "index or -1"
contract, and both are small loops over the array. But one halves the search
space with two mutable bounds, the other scans linearly. Tempting for a
signature-first matcher; must stay `none`.

### u04 — reduce ↔ for-loop
The weighted mean is computed once with `reduce` over an accumulator object and
once with an explicit `for` loop and two `let` accumulators. Same arithmetic,
same guards, radically different statement kinds and nesting. Marked `similar`
honestly: the rewrite removes the callback, the object accumulator and the
method-call chain, which should cost real AST/control-flow similarity.

### u05 — early-return ↔ nested-if
`passwordStrength` guards with two early returns; `nestedPasswordScore` wraps
the same scoring body in two nested positive ifs and falls through to a single
`return 0`. The statement multiset is almost unchanged (same regex tests, same
increments), only the control-flow skeleton inverts. Should still be
`duplicate` — this is the classic guard-style refactor.

### u06 — if/else ↔ ternary chain
Six-way HTTP status classification: canon uses an if/else-if chain, app uses a
nested ternary returning the same labels for the same numeric ranges. Tests
whether branch normalization sees through statement-kind changes when the
conditions and results are identical.

### u07 — destructured params ↔ plain params
`joinCsv` takes optional positional params and defaults them inside the body;
`joinDelimited` takes a destructured options object with parameter defaults and
an identical body. Only the signature is reshaped — the quoting/escaping logic
is untouched. Should be `duplicate`; a signature-heavy matcher might wobble.

### u08 — NEGATIVE: same domain, different algorithm
Both functions produce a `Record` from inputs and use an `out` accumulator with
a loop, but `deepMerge` recursively merges two objects (with type guards and
spreading) while `mergePairs` zips two parallel arrays. Same vocabulary,
unrelated algorithms and different signatures. Must stay `none`.

### u09 — async/await ↔ .then chain
`loadUser` awaits fetch, checks `ok`, awaits `json()`, validates and projects.
`fetchUserById` expresses the identical steps as a `.then().then()` chain with
the same error messages, type checks and trim. Awaits become arrows; the
semantic pipeline is unchanged. Expected `duplicate` if the engine normalizes
async sugar; this is one of the harder positives.

### u10 — try/catch ↔ .catch, throw ↔ error object
`parseSettings` throws from a try/catch; `readSettings` wraps the same parse and
validation in `Promise.resolve().then().catch()` and returns
`{ok, value, error}` instead of throwing. The validation core (same checks,
same clamp, same lowercase) is identical, but sync→async, throw→return and the
extra wrapper dilute structure and control flow. Marked `similar` honestly.

### u11 — NEGATIVE: shared boilerplate, different core
`computeShipping` deliberately copies `computeTax`'s entire validation shell
(finite/positive amount guard, region trim/uppercase guard, identical
`{ok, value, note}` contract) but the core is a longer, different algorithm:
zone lookup, express multiplier, free-shipping thresholds. The shared prefix is
real boilerplate, not the algorithm. A prefix/suffix-heavy matcher will be
tempted; the differing core must keep it `none`.

### u12 — NEGATIVE: inverse operations
`parseQueryString` (string → record) and `formatQueryString` (record → string)
are exact inverses sharing `encodeURIComponent`/`decodeURIComponent`, `+`, `&`,
`=`, `?` handling. Data flow, loop subject and return type are opposite.
Must stay `none` — inverse pairs are the classic false-positive bait.

### u13 — NEGATIVE: same skeleton, strings vs numbers
`snapToGrid` mirrors `truncateText`'s clamp skeleton (guard, normalize a limit,
early return when within bounds, combine a remainder) but operates on numbers
with modulo arithmetic and round-up/down branching instead of string length and
`slice`. Same shape family, different types and different branching. Must stay
`none`; this probes whether shape-only matching over-fires across domains.

### u14 — recursive ↔ iterative
`deepFlatten` recurses; `flattenIterative` uses an explicit reversed LIFO stack
that preserves left-to-right output order. Same result, same `Array.isArray`
branch and push logic, but recursion, the nested for-of and the call disappear.
Marked `similar`: this is a genuinely hard positive and the structural distance
is large. If the engine reports `duplicate`, even better.

### u15 — callback-heavy pipeline, renamed helpers
`summarizeOrders` chains inline `.map().filter().reduce()` arrows;
`tallyPaidOrders` extracts three named helpers, swaps filter before map (safe:
the map only projects), and reduces to a plain number. Same pipeline semantics,
different arrow nesting and call order. Expected `duplicate` if callback
normalization is decent; the reorder is the sneaky part.

### u16 — object plumbing: reorder + spread
`buildUserProfile` computes three consts and returns a fixed-order literal;
`makeProfile` reorders the independent consts, builds a partial base object and
spreads it plus the remaining keys, with shuffled property order. Identical
computations and result shape, different assembly. Should be `duplicate`.

### u17 — split across two functions
`processRecord` (validate + clamp + grade + render) is split into `cleanRecord`
(validate + clamp, returning `null` on bad name) and `formatGrade` (grade +
render). Combined they equal the canon body except the error seam. The manifest
grades `cleanRecord` — the larger half — and expects `similar` via parts.
`formatGrade` is the smaller half and may legitimately score lower; the arbiter
should treat a `similar` on either half as the trap passing.

### u18 — mirror-image loop (author's invention)
`isSortedAscending` scans forward comparing `prev > curr`; `isNonDecreasing`
scans backward comparing `curr < prev`, inverts the length guard (`< 2` vs
`<= 1`) and swaps the pairwise local declarations. Same algorithm and result,
but loop direction, comparison orientation, guard polarity and declaration
order all differ — nothing is copied verbatim. Tests whether the engine
recognizes a mirrored traversal rather than a renamed one.

## Honesty notes (where the author expects misses)

The engine vetoes `duplicate` when the AST signal is < 0.75, and weights
signature .3 / structure .3 / ast .2 / controlFlow .2. Several positives below
change statement *kinds* wholesale, which can push the AST multiset under the
veto even when the logic is identical. Those are honest `duplicate` demands, but
they are the ones most likely to land at `similar` (or `none`) in practice.

- **u06, u09, u15 — AST-veto risk.** if/else→ternary (u09 async→.then, u15
  inline-arrows→named-helpers) replace whole statement kinds, so the normalized
  subtree multiset can drop below 0.75 and veto `duplicate`. If the engine
  normalizes branch/async/callback sugar these pass; if not, expect `similar`.
  This is the single biggest source of expected misses among the positives.
- **u04, u10, u14 — marked `similar` on purpose.** The rewrite removes whole
  constructs (reduce callback, try/catch, recursion). If the AST signal is
  strict these can fall to `none` — a real risk, not a rigged expectation.
- **u07 — signature risk.** The body is identical but the signature is reshaped
  (two optional positional params → one destructured options object), which
  costs the .3 signature weight. Should still clear `duplicate` on the body
  signals alone, but a signature-heavy matcher could wobble to `similar`.
- **u17 — depends on `parts` mode.** It only passes if the engine compares a
  split half against the whole. If parts are compared whole-to-whole only, it
  will miss. `cleanRecord` is the graded (larger) half; `formatGrade` may score
  lower and a `similar` on either half should count as the trap passing.
- **u05, u16, u18 — expected solid.** Guard→nested-if (u05), reorder+spread
  (u16) and the mirrored loop (u18) keep the statement multiset and computations
  nearly intact, so they should clear `duplicate` comfortably. u18 is the
  author's invention and the one I am most curious to see measured.
- **u11 and u13 — the riskiest negatives.** u11's shared shell is long and the
  signatures nearly match; u13 deliberately mirrors the clamp skeleton. Both
  rely on the *differing core / branching* to stay `none`. If the engine is
  prefix/shape-heavy these are the two most likely false positives. u03, u08,
  u12 are safer negatives (clearly different algorithms / opposite data flow).
