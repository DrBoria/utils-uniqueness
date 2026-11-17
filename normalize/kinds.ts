"use strict";

// The node-kind language lives in ../constants (section 5c) — it is vocabulary,
// not normalization. This module is the historical import site, so it keeps
// re-exporting the same names instead of forcing every consumer to change.
//
// `KINDS` keeps its old name for the complete set; `AST_KINDS` is the same set.

import { EXPRESSION_KINDS, JSX_KINDS, STATEMENT_KINDS, AST_KINDS } from "../constants";

const KINDS = AST_KINDS;

export {  KINDS, EXPRESSION_KINDS, JSX_KINDS, STATEMENT_KINDS  };
