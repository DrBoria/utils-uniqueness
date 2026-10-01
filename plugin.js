"use strict";

/**
 * plugin.js
 *
 * ESLint flat-config export for the utils-uniqueness rule.
 *
 * Usage:
 *   const utilsUniq = require("@md-code/utils-uniqueness/plugin");
 *   module.exports = [
 *     {
 *       plugins: { "md-code": utilsUniq },
 *       rules: { "md-code/utils-uniqueness": "warn" },
 *     },
 *   ];
 */

module.exports = {
	rules: {
		"utils-uniqueness": require("./index"),
	},
};
