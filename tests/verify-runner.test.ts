import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCall } from "../src/git-runtime";
import { executeVerifyStep, runDeclaredVerification } from "../src/verify-runner";

describe("verification containment", () => {
	test("does not inherit arbitrary operator environment or HOME", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-verify-env-"));
		const previous = process.env.FOUNDRY_SECRET_PROBE;
		process.env.FOUNDRY_SECRET_PROBE = "must-not-cross";
		try {
			const result = executeVerifyStep(cwd, { id: "env", command: "node", executable: process.execPath, args: ["-e", "process.stdout.write(JSON.stringify({secret:process.env.FOUNDRY_SECRET_PROBE||null,home:process.env.HOME||process.env.USERPROFILE||null}))"] });
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain('"secret":null');
			expect(result.output).not.toContain("must-not-cross");
			expect(result.output).not.toContain(process.env.HOME ?? "__missing_home__");
		} finally {
			if (previous === undefined) delete process.env.FOUNDRY_SECRET_PROBE;
			else process.env.FOUNDRY_SECRET_PROBE = previous;
		}
	});

	test("host execution can be made fail-closed when a sandbox is required", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-verify-sandbox-"));
		const previous = process.env.FOUNDRY_VERIFY_REQUIRE_SANDBOX;
		process.env.FOUNDRY_VERIFY_REQUIRE_SANDBOX = "1";
		try {
			const result = executeVerifyStep(cwd, { id: "env", command: "node", executable: process.execPath, args: ["-e", "process.stdout.write('ran')"] });
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("VERIFY_SANDBOX_GATE");
		} finally {
			if (previous === undefined) delete process.env.FOUNDRY_VERIFY_REQUIRE_SANDBOX;
			else process.env.FOUNDRY_VERIFY_REQUIRE_SANDBOX = previous;
		}
	});

	test("declared verification resolves a package script and records evidence", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-verify-declared-"));
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { smoke: `node -e \"process.stdout.write('ok')\"` } }));
		gitCall(cwd, ["init", "-q"]);
		gitCall(cwd, ["add", "."]);
		gitCall(cwd, ["-c", "user.name=Foundry Test", "-c", "user.email=foundry@test.invalid", "commit", "-qm", "fixture"]);
		const result = runDeclaredVerification(cwd, ["smoke"]);
		expect(result.ok).toBe(true);
		expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(result.rows[0]?.id).toBe("script:smoke");
	}, 20000);
});
