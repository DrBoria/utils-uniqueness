# @md-code/utils-uniqueness

ESLint rule + CLI scanner that finds **duplicate utility functions** across a
TypeScript codebase. It is the utilities counterpart of
`@md-code/component-uniqueness` (CU): CU catches duplicated components,
this package catches duplicated plain functions.

Two pieces:

1. **Scanner (CLI)** — walks your utils folders, extracts every utility
   function with the TypeScript compiler API, cross-checks them with a
   token-level **jscpd** pass, and writes a JSON catalog of functions and
   duplicate clusters.
2. **ESLint rule** — `md-code/utils-uniqueness` matches app code
   against that catalog and reports every function that duplicates a catalog
   entry.

## Install

```sh
npm i -D @md-code/utils-uniqueness
```

Peer dependency: `eslint >= 8.40`.

`typescript` is bundled (v5.x) rather than a peer: the rule drives the
TypeScript compiler API to parse your files, and TypeScript 7 (the Go rewrite)
ships no JS compiler API — so the package pins its own 5.x and uses it
regardless of the version installed in your project.

## CLI (build the catalog)

```sh
md-code-utils-uniqueness --roots core/utils:core/ehr/_db --report
```

Options:

| Flag | Meaning |
| --- | --- |
| `--roots <d1>:<d2>` | Utils directories to catalog (repo-relative or absolute). Required unless the rule options in `eslint.config.js` define `utilsFolder`. |
| `--out <file>` | Catalog path. Default `reports/utils-catalog.json`. |
| `--repo-root <dir>` | Repo root. Default: discovered by walking up. |
| `--app-roots <d1>:<d2>` | Extra roots for the jscpd pass only (default: repo root). |
| `--no-jscpd` | Skip the jscpd raw-clone source. |
| `--check` | CI gate: exit 1 when the catalog would change. |
| `--report [file]` | Write the Markdown duplicate report (default `reports/utils-duplicates.md`). |
| `--verbose` | Log per-stage counts. |

## ESLint rule

```js
// eslint.config.js
import utilsUniqueness from "@md-code/utils-uniqueness";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "md-code": utilsUniqueness },
    rules: {
      "md-code/utils-uniqueness": [
        "warn",
        {
          catalogPath: "reports/utils-catalog.json",
          utilsFolder: ["core/utils/", "core/ehr/_db/"],
        },
      ],
    },
  },
];
```

The rule reports `duplicateUtility` for every function whose body matches a
catalog cluster (by exact path+line), and `missingCatalog` when the catalog
file does not exist yet.

### Rule options

| Option | Default | Meaning |
| --- | --- | --- |
| `catalog` / `catalogPath` | `reports/utils-catalog.json` | Inline catalog object or path to the catalog file. |
| `utilsFolder` | — | Utils folders (string or `{ path }`). Required for the scanner when `--roots` is absent. |
| `include` / `exclude` | sensible defaults | Minimatch filters for the scanner. |
| `useJscpd` | `true` | Enable the jscpd raw-clone source in the scanner. |
| `jscpdMinTokens` / `jscpdSimilarity` | `20` / `0.7` | jscpd thresholds. |
| `debt` | — | `false` to disable the debt ledger, `true` for the default `reports/lint-debt.json`, or a path. Findings listed in the ledger are suppressed. |
| `root` | discovered | Repo root for resolving relative paths. |
| `thresholds` | see below | Matching thresholds. |

### Thresholds

| Key | Default | Meaning |
| --- | --- | --- |
| `minBodyTokens` | `8` | Minimum normalized body tokens to be considered a utility. |
| `signatureExact` | `true` | Cluster by exact normalized signature. |
| `signatureMinParams` | `1` | Minimum params for a signature-tier match to be meaningful. |
| `bodyMinRatio` | `0.6` | Jaccard ratio on normalized body tokens for the body tier. |
| `bodyMinParams` | `1` | Minimum params for a body-tier match to be meaningful. |
| `jscpd.enabled` | `false` | Run the jscpd pass at all. |
| `jscpd.mode` / `minTokens` / `minLines` / `similarity` | `strict` / `35` / `4` / `0.7` | jscpd CLI settings. |
| `jscpd.whole.minCoverage` | `0.5` | A clone must cover at least this share of both functions for the whole tier. |
| `jscpd.whole.minDistinctiveRatio` | `0.35` | Minimum distinctive-token share for the whole tier. |
| `jscpd.fragment.minTokens` / `minLines` / `minDistinctiveRatio` | `35` / `4` / `0.35` | Fragment tier: short but real shared chunks. |
| `requireExported` | `false` | Only catalog exported functions. |

## How duplicates are found

Four tiers, strongest first:

1. **signature** — identical normalized signature (name + params + return).
2. **body** — Jaccard similarity of normalized body token streams
   (strings, comments and identifiers blanked; keywords and uppercase tokens
   kept) above `bodyMinRatio`.
3. **jscpd** — token-level clones reported by the jscpd CLI that cover a
   large share of both functions (`whole.minCoverage`); unlike the AST tiers
   it also catches clones with renamed parameters and reordered statements.
4. **fragment** — a jscpd clone that is shorter than the whole-function bar
   but still long enough (`fragment.minTokens` / `fragment.minLines`) and
   distinctive enough (`fragment.minDistinctiveRatio`) to be a real shared
   chunk rather than boilerplate.

React components and test/story callbacks are excluded from extraction.

## Debt ledger

To keep a clean baseline while you migrate, list known files in
`reports/lint-debt.json`. The ledger is file-scoped: any finding in a listed
file is suppressed.

```json
{
  "core/ehr/_db/fhir.ts::utils-uniqueness": 3
}
```

Keys are `<repo-relative file path>::<ruleId>`; the value is the finding count
(bookkeeping — the rule only checks key presence). The ledger is shrink-only:
a key must be removed once the file is clean.
