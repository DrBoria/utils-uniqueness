"use strict";

// Kept so older readers (`require("./logger")` in main.js and in a consumer's
// script) keep working after the logger moved into `report/`. The engine is the
// one in `report/logger.js` — there is no second state.

module.exports = require("./report/logger");
