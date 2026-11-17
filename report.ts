"use strict";

// Kept so `require("./report")` keeps working after the markdown report moved
// into `report/cli-report.js`. The engine is the one in `report/`.

export * from "./report/cli-report";
