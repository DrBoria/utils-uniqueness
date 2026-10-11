"use strict";

const pascalWords = (s) => String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);

module.exports = { pascalWords };
