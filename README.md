# @md-code/utils-uniqueness

ESLint rule + CLI scanner that finds **duplicate utility functions** across a
TypeScript codebase. It is the utilities counterpart of
`@md-code/react-component-uniqueness` (RDU): RDU catches duplicated React
components, this package catches duplicated plain functions.

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
import jsts from "@md-code/utils-uniqueness/plugin";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "md-code": jsts },
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
| `bodyMinRatio` | `0.6` | Jaccard ratio on normalized body tokens for the body tier. |
| `jscpdMinTokens` / `jscpdSimilarity` | `20` / `0.7` | jscpd tier. |
| `requireExported` | `false` | Only catalog exported functions. |

## How duplicates are found

Three tiers, strongest first:

1. **signature** — identical normalized signature (name + params + return).
2. **body** — Jaccard similarity of normalized body token streams
   (strings, comments and identifiers blanked; keywords and uppercase tokens
   kept) above `bodyMinRatio`.
3. **jscpd** — raw token-level clones reported by the jscpd CLI, which is
   unfiltered: it catches clones the two AST tiers miss (renamed parameters,
   reordered statements, partially shared bodies).

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
