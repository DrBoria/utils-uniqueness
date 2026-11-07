import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseFunctions, setTsConfig } = require("../playgrounds/typescript.js");
const { buildCandidate } = require("../normalize/candidate.js");

// A repo whose TypeScript declares `paths` (`@app/*` → `src/*`). Both helpers
// take the SAME interface code, one spelled as an alias and one as a relative
// path: the same type, so the same signature. A parser whose program does not
// know `paths` reads the aliased parameter as `any` — the signatures stop being
// equal, and a pair that IS a duplicate is never reported.
let root: string;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "uu-aliases-"));
	fs.mkdirSync(path.join(root, "src"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "tsconfig.json"),
		JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } } }, null, 2),
		"utf8",
	);
	fs.writeFileSync(path.join(root, "src", "types.ts"), "export interface Credentials {\n\tuser: string;\n\tpassword: string;\n}\n", "utf8");
	fs.writeFileSync(
		path.join(root, "src", "alias.ts"),
		'import { Credentials } from "@app/types";\n\nexport function login(credentials: Credentials) {\n\treturn credentials.user;\n}\n',
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "src", "relative.ts"),
		'import { Credentials } from "./types";\n\nexport function loginCopy(credentials: Credentials) {\n\treturn credentials.user;\n}\n',
		"utf8",
	);
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const candidateOf = (rel: string) => {
	const [descriptor] = parseFunctions(path.join(root, rel));
	return buildCandidate(descriptor, {});
};

describe("tsconfig aliases", () => {
	it("an aliased parameter type reads the same as a relative one", () => {
		// The scan walks the repo, so the type file is in the program before the
		// helpers are parsed — that is the only order a real run has.
		parseFunctions(path.join(root, "src", "types.ts"));

		const alias = candidateOf("src/alias.ts");
		const relative = candidateOf("src/relative.ts");

		expect(alias.signature.params[0].type).toBe("Credentials");
		expect(relative.signature.params[0].type).toBe("Credentials");
		expect(alias.signature.signatureKey).toBe(relative.signature.signatureKey);
	});

	it("takes the config path explicitly when the project keeps it elsewhere", () => {
		// A config whose NAME is not `tsconfig.json` is never discovered by walking
		// up; the caller has to be able to point at it.
		const explicit = path.join(root, "tsconfig.app.json");
		fs.copyFileSync(path.join(root, "tsconfig.json"), explicit);
		fs.rmSync(path.join(root, "tsconfig.json"));
		try {
			setTsConfig(explicit);
			expect(candidateOf("src/alias.ts").signature.params[0].type).toBe("Credentials");
		} finally {
			setTsConfig(null);
			fs.copyFileSync(explicit, path.join(root, "tsconfig.json"));
			fs.rmSync(explicit);
		}
	});
});
