"use strict";

// Kept so `require("./report")` keeps working after the markdown report moved
// into `report/cli-report.js`. The engine is the one in `report/`.

module.exports = require("./report/cli-report");
