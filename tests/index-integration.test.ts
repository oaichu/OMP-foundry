import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerFoundryExtension from "../src/index";
import { hashPlanArtifact } from "../src/plan";
import { lockArtifactHash } from "../src/release";
import { loadState, saveState } from "../src/state-machine";
import { defaultState } from "../src/types";

function fakeZod() {
	const chain = { optional() { return this; } };
	return {
		object: (_shape: unknown) => ({}),
		string: () => ({ ...chain }),
		array: (_value: unknown) => ({}),
	};
}

function harness() {
	const tools = new Map<string, any>(), commands = new Map<string, any>(), handlers = new Map<string, any[]>(), messages: string[] = [];
	const api: any = {
		zod: fakeZod(),
		setLabel() {},
		sendUserMessage(message: string) { messages.push(message); },
		on(name: string, handler: any) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, config: any) { commands.set(name, config); },
	};
	registerFoundryExtension(api);
	return { tools, commands, handlers, messages };
}

function ctx(cwd: string, sessionId = "test-session", agent?: string) {
	return {
		cwd,
		sessionManager: { getSessionId: () => sessionId, getEntries: () => agent ? [{ type: "session_init", agent }] : [] },
		ui: { notify() {}, setStatus() {} },
		setTimeout() {},
		clearTimer() {},
		abort() {},
		async waitForIdle() {},
	};
}

function watchdogCtx(cwd: string, sessionId: string, agent: string) {
	let timeoutCallback: (() => void) | undefined;
	let aborted = false;
	return {
		...ctx(cwd, sessionId, agent),
		setTimeout(callback: () => void) { timeoutCallback = callback; return "stage-watchdog"; },
		clearTimer() {},
		abort() { aborted = true; },
		triggerTimeout() { timeoutCallback?.(); },
		wasAborted() { return aborted; },
	};
}

describe("extension integration smoke", () => {
	test("registers canonical tools/commands and no agent-owned lifecycle tools", () => {
		const { tools, commands } = harness();
		expect(tools.has("foundry_status")).toBe(true);
		expect(tools.has("foundry_skill_read")).toBe(true);
		expect(tools.has("aatp_begin")).toBe(false);
		expect(tools.has("aatp_complete")).toBe(false);
		expect(commands.has("foundry")).toBe(true);
		expect(commands.has("foundry-init")).toBe(true);
		expect(commands.has("foundry-doctor")).toBe(true);
		expect(commands.has("release-check")).toBe(true);
		expect(commands.has("plan")).toBe(true);
		expect(commands.has("approve")).toBe(true);
		expect(commands.has("ok")).toBe(true);
		expect(commands.has("go")).toBe(true);
		expect(commands.has("run")).toBe(true);
		expect(commands.has("debug")).toBe(true);
	});

	test("installed plugin is inert in an ungoverned repository", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-inert-"));
		const { handlers } = harness();
		const toolHook = handlers.get("tool_call")![0];
		const agentHook = handlers.get("before_agent_start")![0];
		expect(await toolHook({ toolName: "write", input: { path: "src/free.ts" } }, ctx(cwd))).toBeUndefined();
		expect(await toolHook({ toolName: "aatp_complete", input: { id: "AATP-1" } }, ctx(cwd))).toBeUndefined();
		expect(await agentHook({ agentName: "implementer" }, ctx(cwd))).toBeUndefined();
		expect(existsSync(join(cwd, ".omp", "foundry-state.yml"))).toBe(false);
		expect(existsSync(join(cwd, "docs", ".foundry-governed"))).toBe(false);
	});

	test("/foundry self-bootstraps a new project without /foundry-init", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-auto-bootstrap-"));
		const { commands, messages } = harness();
		await commands.get("foundry")!.handler("Build a small API", ctx(cwd));
		expect(existsSync(join(cwd, ".omp", "foundry-state.yml"))).toBe(true);
		expect(existsSync(join(cwd, ".omp", "config.yml"))).toBe(true);
		expect(existsSync(join(cwd, "docs", ".foundry-governed"))).toBe(true);
		expect(existsSync(join(cwd, "docs", "PRODUCT.md"))).toBe(true);
		expect(readFileSync(join(cwd, ".omp", "config.yml"), "utf8")).toContain("modelRoleStorage: project");
		expect(loadState(cwd).phase).toBe("discovery");
		expect(messages.at(-1)).toContain("Foundry enabled for this project");
		expect(messages.at(-1)).toContain("Spawn blocking product-analyst");
	});

	test("governed repository enforces lifecycle gate", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-hook-"));
		saveState(cwd, defaultState());
		const { handlers } = harness();
		const hook = handlers.get("tool_call")![0];
		const result = await hook({ toolName: "aatp_complete", input: { id: "AATP-1" } }, ctx(cwd));
		expect(result.block).toBe(true);
		expect(result.reason).toContain("LIFECYCLE_GATE");
	});

	test("unknown task agents and marker-only projects fail closed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-task-gate-"));
		const { handlers } = harness();
		const taskHook = handlers.get("tool_call")![0];
		saveState(cwd, defaultState());
		const unknown = await taskHook({ toolName: "task", toolCallId: "unknown", input: { agent: "helper", task: "do anything" } }, ctx(cwd));
		expect(unknown.block).toBe(true);
		expect(unknown.reason).toContain("TASK_GATE");
		const markerOnly = mkdtempSync(join(tmpdir(), "foundry-marker-only-"));
		mkdirSync(join(markerOnly, "docs"), { recursive: true });
		writeFileSync(join(markerOnly, "docs", ".foundry-governed"), "marker\n");
		const blocked = await taskHook({ toolName: "write", input: { path: "src/x.ts" } }, ctx(markerOnly));
		expect(blocked.block).toBe(true);
		expect(blocked.reason).toContain("STATE_MISSING_GATE");
	});

	test("design approve handler executes and locks without runtime ReferenceError", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-index-"));
		mkdirSync(join(cwd, "docs"), { recursive: true });
		mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		writeFileSync(join(cwd, "docs", "AATP", "AATP-old.md"), "old\n");
		writeFileSync(join(cwd, "docs", "DESIGN.md"), "# design\n");
		const state = defaultState();
		state.product.status = "approved"; state.product.sha256 = "123";
		state.master_plan.status = "locked"; state.master_plan.sha256 = "123";
		state.phase = "design";
		state.design.required = true;
		saveState(cwd, state);
		const { commands, messages } = harness();
		await commands.get("design")!.handler("approve", ctx(cwd));
		const after = loadState(cwd);
		expect(after.design.status).toBe("locked");
		expect(after.phase).toBe("aatp");
		expect(messages.at(-1)).toContain("AATP compiler");
		expect(messages.at(-1)).toContain("foundry_synth");
		expect(existsSync(join(cwd, "docs", "AATP", "AATP-old.md"))).toBe(false);
		expect(readdirSync(join(cwd, "docs", "AATP", "archive"), { withFileTypes: true }).length).toBeGreaterThan(0);
	});

	test("AATP phase auto-routes one synthesis compiler and seals its project DAG", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-aatp-compiler-"));
		mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		writeFileSync(join(cwd, "docs", "PRODUCT.md"), "# Product\nlocked evidence\n");
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "# Master plan\nlocked evidence\n");
		const state = defaultState();
		state.product.status = "approved"; state.product.sha256 = "123";
		state.master_plan.status = "locked"; state.master_plan.sha256 = "123";
		state.design.required = false;
		state.design.status = "not_required";
		state.phase = "aatp";
		expect(lockArtifactHash(cwd, state, "product")).toBe(true);
		expect(lockArtifactHash(cwd, state, "master_plan")).toBe(true);
		saveState(cwd, state);
		const { handlers } = harness();
		const taskHook = handlers.get("tool_call")![0];
		const resultHook = handlers.get("tool_result")![0];
		const blocked = await taskHook({ toolName: "task", toolCallId: "worker-run", input: { agent: "implementer", task: "Implement AATP-001" } }, ctx(cwd));
		expect(blocked.block).toBe(true);
		expect(blocked.reason).toContain("AATP_COMPILER_GATE");
		const compilerTask = await taskHook({ toolName: "task", toolCallId: "compiler-run", input: { agent: "aatp-compiler", task: "Compile the complete project AATP DAG" } }, ctx(cwd));
		expect(compilerTask).toBeUndefined();
		writeFileSync(join(cwd, "docs", "AATP", "AATP-001.md"), "---\nid: AATP-001\nobjective: Add the first governed slice\ndependencies:\n  - none\nallowed_files:\n  - src/example.ts\nforbidden_files:\n  - docs/MASTER_PLAN.md\nrisk: normal\nacceptance:\n  - the slice satisfies the locked plan\nverification:\n  - typecheck\n---\n");
		const sealed = await resultHook({ toolName: "task", toolCallId: "compiler-run", details: { results: [{ index: 0, agent: "aatp-compiler", id: "compiler-1", exitCode: 0 }] } }, ctx(cwd));
		expect(sealed.isError).not.toBe(true);
		expect(sealed.content[0].text).toContain("AATP_COMPILED: 1");
		const after = loadState(cwd);
		expect(after.aatp.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(after.tickets["AATP-001"]?.status).toBe("ready");
		expect(readFileSync(join(cwd, "docs", "AATP", "INDEX.md"), "utf8")).toContain("AATP-001");
		const beforeBuild = await taskHook({ toolName: "task", toolCallId: "too-early", input: { agent: "implementer", task: "Implement AATP-001" } }, ctx(cwd));
		expect(beforeBuild.reason).toContain("AATP_EXECUTION_GATE");
	});

	test("AATP compiler seals terminal capability output after a provider post-write failure", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-aatp-provider-recovery-"));
		mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		writeFileSync(join(cwd, "docs", "PRODUCT.md"), "# Product\n");
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "# Master plan\n");
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.master_plan.status = "locked"; state.master_plan.sha256 = "123"; state.design.status = "not_required"; state.phase = "aatp";
		expect(lockArtifactHash(cwd, state, "product")).toBe(true); expect(lockArtifactHash(cwd, state, "master_plan")).toBe(true); saveState(cwd, state);
		const { handlers, tools } = harness(), taskHook = handlers.get("tool_call")![0], agentHook = handlers.get("before_agent_start")![0], resultHook = handlers.get("tool_result")![0];
		await taskHook({ toolName: "task", toolCallId: "provider-compiler", input: { agent: "aatp-compiler", task: "compile AATP" } }, ctx(cwd));
		const prompt = await agentHook({}, ctx(cwd, "compiler-session", "aatp-compiler"));
		const capability = prompt.message.content.match(/Compiler capability .*: ([a-f0-9]{64})/)?.[1];
		expect(capability).toBeTruthy();
		const spec = "---\nid: AATP-001\nobjective: Add the first governed slice\ndependencies:\n  - none\nallowed_files:\n  - src/example.ts\nforbidden_files:\n  - docs/MASTER_PLAN.md\nrisk: normal\nsecurity_sensitive: false\nacceptance:\n  - the slice satisfies the locked plan\nverification:\n  - typecheck\n---\n";
		const specWrite = await tools.get("foundry_aatp_write")!.execute("write", { path: "docs/AATP/AATP-001.md", content: spec, capability }, "session", null, ctx(cwd, "compiler-session"));
		expect(specWrite.isError).not.toBe(true);
		const indexWrite = await tools.get("foundry_aatp_write")!.execute("write", { path: "docs/AATP/INDEX.md", content: "# AATP index\n", capability }, "session", null, ctx(cwd, "compiler-session"));
		expect(indexWrite.isError).not.toBe(true);
		const recovered = await resultHook({ toolName: "task", toolCallId: "provider-compiler", details: { results: [{ index: 0, agent: "aatp-compiler", id: "compiler-1", exitCode: 1, error: "Tool choice 'required' must be specified with 'tools' parameter.", aborted: true }] } }, ctx(cwd));
		expect(recovered.isError).not.toBe(true);
		expect(recovered.content[0].text).toContain("AATP_COMPILER_RECOVERED");
		expect(loadState(cwd).aatp.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(loadState(cwd).tickets["AATP-001"]?.status).toBe("ready");
	});

	test("compiler capability writer is scoped and native AATP writes stay denied", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-aatp-capability-"));
		mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		writeFileSync(join(cwd, "docs", "PRODUCT.md"), "product\n");
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "plan\n");
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.master_plan.status = "locked"; state.master_plan.sha256 = "123"; state.design.status = "not_required"; state.phase = "aatp";
		expect(lockArtifactHash(cwd, state, "product")).toBe(true); expect(lockArtifactHash(cwd, state, "master_plan")).toBe(true); saveState(cwd, state);
		const { handlers, tools } = harness(), taskHook = handlers.get("tool_call")![0], agentHook = handlers.get("before_agent_start")![0];
		await taskHook({ toolName: "task", toolCallId: "cap-compiler", input: { agent: "aatp-compiler", task: "compile AATP" } }, ctx(cwd));
		const prompt = await agentHook({}, ctx(cwd, "compiler-session", "aatp-compiler"));
		const capability = prompt.message.content.match(/Compiler capability .*: ([a-f0-9]{64})/)?.[1];
		expect(capability).toBeTruthy();
		const native = await taskHook({ toolName: "write", input: { path: "docs/AATP/AATP-001.md" } }, ctx(cwd));
		expect(native.block).toBe(true);
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const parentAttempt = await tools.get("foundry_aatp_write")!.execute("write", { path: "docs/AATP/AATP-001.md", content: "parent must not write\n", capability }, "session", null, ctx(cwd, "parent-session"));
			expect(parentAttempt.isError).toBe(true);
			expect(parentAttempt.content[0].text).toContain(attempt === 2 ? "AATP_COMPILER_CAPABILITY_CIRCUIT_BREAKER" : "AATP_COMPILER_CAPABILITY_DENIED");
		}
		const written = await tools.get("foundry_aatp_write")!.execute("write", { path: "docs/AATP/AATP-001.md", content: "---\nid: AATP-001\n---\n", capability }, "session", null, ctx(cwd, "compiler-session"));
		expect(written.isError).not.toBe(true);
		expect(readFileSync(join(cwd, "docs", "AATP", "AATP-001.md"), "utf8")).toContain("AATP-001");
	});

	test("Plan capability is delivered from session_init and parent guesses cannot write", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-plan-capability-"));
		mkdirSync(join(cwd, "docs", "planning"), { recursive: true });
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.mode = "plan"; state.phase = "planning"; state.planning.stage = "draft"; saveState(cwd, state);
		const { handlers, tools } = harness(), taskHook = handlers.get("tool_call")![0], agentHook = handlers.get("before_agent_start")![0];
		await taskHook({ toolName: "task", toolCallId: "plan-capability", input: { agent: "plan-drafter", task: "draft the locked plan" } }, ctx(cwd));
		const prompt = await agentHook({}, ctx(cwd, "plan-session", "plan-drafter"));
		const capability = prompt.message.content.match(/Plan capability .*: ([a-f0-9]{64})/)?.[1];
		expect(capability).toBeTruthy();
		const denied = await tools.get("foundry_plan_write")!.execute("write", { path: "docs/planning/MASTER_PLAN_DRAFT.md", content: "parent must not write\n", capability }, "session", null, ctx(cwd, "parent-session"));
		expect(denied.isError).toBe(true);
		expect(denied.content[0].text).toContain("PLAN_CAPABILITY_DENIED");
		const written = await tools.get("foundry_plan_write")!.execute("write", { path: "docs/planning/MASTER_PLAN_DRAFT.md", content: "# Draft\n", capability }, "session", null, ctx(cwd, "plan-session"));
		expect(written.isError).not.toBe(true);
		expect(readFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "utf8")).toContain("Draft");
	});

	test("Plan stage watchdog aborts a stalled stage without advancing state", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-plan-watchdog-"));
		mkdirSync(join(cwd, "docs", "planning"), { recursive: true });
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.mode = "plan"; state.phase = "planning"; state.planning.stage = "draft"; saveState(cwd, state);
		const { handlers } = harness();
		const taskHook = handlers.get("tool_call")![0], agentHook = handlers.get("before_agent_start")![0], resultHook = handlers.get("tool_result")![0];
		await taskHook({ toolName: "task", toolCallId: "stalled-plan", input: { agent: "plan-drafter", task: "draft the plan" } }, ctx(cwd));
		const stalled = watchdogCtx(cwd, "plan-session", "plan-drafter");
		await agentHook({}, stalled);
		stalled.triggerTimeout();
		expect(stalled.wasAborted()).toBe(true);
		const failed = await resultHook({ toolName: "task", toolCallId: "stalled-plan", details: { results: [{ index: 0, agent: "plan-drafter", exitCode: 1, aborted: true }] } }, stalled);
		expect(failed.isError).toBe(true);
		expect(failed.content[0].text).toContain("PLAN_STAGE_TIMEOUT");
		expect(failed.content[0].text).toContain("fresh child context");
		expect(loadState(cwd).planning.stage).toBe("draft");
	});

	test("Plan advances after a terminal capability write despite a provider post-write failure", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-plan-provider-recovery-"));
		mkdirSync(join(cwd, "docs", "planning"), { recursive: true });
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.mode = "plan"; state.phase = "planning"; state.planning.stage = "draft"; saveState(cwd, state);
		const { handlers, tools } = harness(), taskHook = handlers.get("tool_call")![0], agentHook = handlers.get("before_agent_start")![0], resultHook = handlers.get("tool_result")![0];
		await taskHook({ toolName: "task", toolCallId: "provider-plan", input: { agent: "plan-drafter", task: "draft the plan" } }, ctx(cwd));
		const prompt = await agentHook({}, ctx(cwd, "plan-session", "plan-drafter"));
		const capability = prompt.message.content.match(/Plan capability .*: ([a-f0-9]{64})/)?.[1];
		expect(capability).toBeTruthy();
		const written = await tools.get("foundry_plan_write")!.execute("write", { path: "docs/planning/MASTER_PLAN_DRAFT.md", content: "# Draft\n\nComplete planning evidence.\n", capability }, "session", null, ctx(cwd, "plan-session"));
		expect(written.isError).not.toBe(true);
		const recovered = await resultHook({ toolName: "task", toolCallId: "provider-plan", details: { results: [{ index: 0, agent: "plan-drafter", id: "plan-1", exitCode: 1, error: "Tool choice 'required' must be specified with 'tools' parameter.", aborted: true }] } }, ctx(cwd));
		expect(recovered.isError).not.toBe(true);
		expect(recovered.content[0].text).toContain("PLAN_STAGE_RECOVERED");
		expect(loadState(cwd).planning.stage).toBe("redteam");
		expect(loadState(cwd).planning.draft_sha256).toMatch(/^[a-f0-9]{64}$/);
	});

	test("capability writers are hidden and stop repeated guessed-token loops", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-capability-breaker-"));
		mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.master_plan.status = "locked"; state.master_plan.sha256 = "123"; state.design.status = "not_required"; state.phase = "aatp"; saveState(cwd, state);
		const { tools } = harness();
		expect(tools.get("foundry_plan_write")!.hidden).toBe(false);
		expect(tools.get("foundry_aatp_write")!.hidden).toBe(false);
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const denied = await tools.get("foundry_aatp_write")!.execute("guess", { path: "docs/AATP/AATP-001.md", content: "must not write\n", capability: `guess-${attempt}` }, "session", null, ctx(cwd, "orchestrator"));
			expect(denied.isError).toBe(true);
			expect(denied.content[0].text).toContain("DO NOT GUESS OR BRUTE-FORCE");
		}
		const tripped = await tools.get("foundry_aatp_write")!.execute("guess", { path: "docs/AATP/AATP-001.md", content: "must not write\n", capability: "guess-final" }, "session", null, ctx(cwd, "orchestrator"));
		expect(tripped.isError).toBe(true);
		expect(tripped.content[0].text).toContain("AATP_COMPILER_CAPABILITY_CIRCUIT_BREAKER");
		expect(existsSync(join(cwd, "docs", "AATP", "AATP-001.md"))).toBe(false);
	});

	test("invalid compiler output stays unsealed and is archived for a clean retry", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-aatp-invalid-")); mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		const state = defaultState(); state.product.status = "approved"; state.product.sha256 = "123"; state.master_plan.status = "locked"; state.master_plan.sha256 = "123"; state.design.status = "not_required"; state.phase = "aatp"; saveState(cwd, state);
		const { handlers } = harness(), taskHook = handlers.get("tool_call")![0], resultHook = handlers.get("tool_result")![0];
		await taskHook({ toolName: "task", toolCallId: "invalid-compiler", input: { agent: "aatp-compiler", task: "Compile the complete project AATP DAG" } }, ctx(cwd));
		writeFileSync(join(cwd, "docs", "AATP", "AATP-002.md"), "---\nid: AATP-002\nobjective: incomplete\ndependencies: []\nallowed_files:\n  - src/example.ts\nforbidden_files:\n  - docs/MASTER_PLAN.md\nrisk: normal\n---\n");
		const failed = await resultHook({ toolName: "task", toolCallId: "invalid-compiler", details: { results: [{ index: 0, agent: "aatp-compiler", exitCode: 0 }] } }, ctx(cwd));
		expect(failed.isError).toBe(true);
		expect(failed.content[0].text).toContain("acceptance");
		expect(loadState(cwd).aatp.manifest_sha256).toBe("");
		expect(existsSync(join(cwd, "docs", "AATP", "AATP-002.md"))).toBe(false);
	});

	test("foundry_exec fails closed outside unlocked design phase", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-exec-"));
		saveState(cwd, defaultState());
		const { tools } = harness();
		const result = await tools.get("foundry_exec")!.execute("1", { id: "build" }, "s", null, ctx(cwd));
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("FOUNDRY_EXEC_GATE");
	});

	test("plan revise invalidates the prior design lock and AATP epoch", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-plan-revise-"));
		const state = defaultState();
		state.product.status = "approved"; state.product.sha256 = "123";
		state.master_plan.status = "locked"; state.master_plan.sha256 = "123";
		state.master_plan.sha256 = "old-plan";
		state.design = { required: false, status: "locked", version: "1.0", sha256: "old-design" };
		state.aatp.epoch = "old-epoch";
		saveState(cwd, state);
		const { commands } = harness();
		await commands.get("plan-revise")!.handler("architecture changed", ctx(cwd));
		const after = loadState(cwd);
		expect(after.master_plan.status).toBe("draft");
		expect(after.master_plan.sha256).toBe("");
		expect(after.design.status).toBe("missing");
		expect(after.design.required).toBe(true);
		expect(after.design.sha256).toBe("");
		expect(after.planning.epoch).not.toBe("");
	});

	test("smart /approve naturally approves product and plan states", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-smart-approve-"));
		mkdirSync(join(cwd, "docs", "planning"), { recursive: true });
		writeFileSync(join(cwd, "docs", "PRODUCT.md"), "# Product Specs\n");
		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "# Draft\n");
		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "# Review\n");
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "# Master Plan\n");

		const state = defaultState();
		state.product.status = "draft";
		saveState(cwd, state);

		const { commands } = harness();
		await commands.get("approve")!.handler("", ctx(cwd));
		const productApproved = loadState(cwd);
		expect(productApproved.product.status).toBe("approved");
		expect(productApproved.mode).toBe("plan");

		// Simulate plan reaching awaiting_lock
		productApproved.planning.stage = "awaiting_lock";
		productApproved.planning.draft_sha256 = hashPlanArtifact(cwd, "draft")!;
		productApproved.planning.review_sha256 = hashPlanArtifact(cwd, "redteam")!;
		productApproved.planning.final_sha256 = hashPlanArtifact(cwd, "synth")!;
		saveState(cwd, productApproved);

		await commands.get("approve")!.handler("", ctx(cwd));
		const planApproved = loadState(cwd);
		expect(planApproved.master_plan.status).toBe("locked");
	});

	test("plan-synth capability write allows writing both MASTER_PLAN and initial AATP specs", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-synth-aatp-"));
		mkdirSync(join(cwd, "docs", "planning"), { recursive: true });
		mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
		writeFileSync(join(cwd, "docs", "PRODUCT.md"), "# Product\n");
		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "# Draft\n");
		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "# Review\n");

		const state = defaultState();
		state.product.status = "approved"; state.product.sha256 = "123";
		state.mode = "plan";
		state.phase = "planning";
		state.planning.stage = "synth";
		state.planning.draft_sha256 = hashPlanArtifact(cwd, "draft")!;
		state.planning.review_sha256 = hashPlanArtifact(cwd, "redteam")!;
		saveState(cwd, state);

		const { handlers, tools } = harness();
		const taskHook = handlers.get("tool_call")![0], agentHook = handlers.get("before_agent_start")![0], resultHook = handlers.get("tool_result")![0];
		await taskHook({ toolName: "task", toolCallId: "synth-run", input: { agent: "plan-synth", task: "synthesize plan and AATP" } }, ctx(cwd));
		const prompt = await agentHook({}, ctx(cwd, "synth-session", "plan-synth"));
		const capability = prompt.message.content.match(/Plan capability .*: ([a-f0-9]{64})/)?.[1];
		expect(capability).toBeTruthy();

		// Write initial AATP spec
		const aatpWrite = await tools.get("foundry_plan_write")!.execute("write", {
			path: "docs/AATP/AATP-001.md",
			content: "---\nid: AATP-001\nobjective: init core\ndependencies:\n  - none\nallowed_files:\n  - src/core.ts\nforbidden_files:\n  - docs/MASTER_PLAN.md\nrisk: normal\nacceptance:\n  - compiles\nverification:\n  - bun test\n---\n",
			capability
		}, "session", null, ctx(cwd, "synth-session"));
		expect(aatpWrite.isError).not.toBe(true);

		// Write MASTER_PLAN (terminal artifact)
		const planWrite = await tools.get("foundry_plan_write")!.execute("write", {
			path: "docs/MASTER_PLAN.md",
			content: "# Master Plan\nComplete synthesis.\n",
			capability
		}, "session", null, ctx(cwd, "synth-session"));
		expect(planWrite.isError).not.toBe(true);

		const result = await resultHook({ toolName: "task", toolCallId: "synth-run", details: { results: [{ index: 0, agent: "plan-synth", exitCode: 0 }] } }, ctx(cwd));
		expect(result.isError).not.toBe(true);
		const finalState = loadState(cwd);
		expect(finalState.planning.stage).toBe("awaiting_lock");
		expect(finalState.aatp.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(finalState.tickets["AATP-001"]).toBeDefined();
	});

	test("verify refuses ungoverned projects and writes no state", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-ungoverned-verify-"));
		const notifies: string[] = [];
		const { commands } = harness();
		const ungovernedCtx = {
			...ctx(dir),
			ui: { notify: (m: string) => notifies.push(m), setStatus() {} },
		};
		await commands.get("verify")!.handler("", ungovernedCtx);
		expect(notifies.some((m) => m.includes("FOUNDRY_GATE"))).toBe(true);
		expect(existsSync(join(dir, ".omp", "foundry-state.yml"))).toBe(false);
	});

	test("plan-revise refuses ungoverned projects and writes no state", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-ungoverned-plan-revise-"));
		const notifies: string[] = [];
		const { commands } = harness();
		const ungovernedCtx = {
			...ctx(dir),
			ui: { notify: (m: string) => notifies.push(m), setStatus() {} },
		};
		await commands.get("plan-revise")!.handler("test reason", ungovernedCtx);
		expect(notifies.some((m) => m.includes("FOUNDRY_GATE"))).toBe(true);
		expect(existsSync(join(dir, ".omp", "foundry-state.yml"))).toBe(false);
	});

	test("release-check refuses ungoverned projects and writes no state", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-ungoverned-release-check-"));
		const notifies: string[] = [];
		const { commands } = harness();
		const ungovernedCtx = {
			...ctx(dir),
			ui: { notify: (m: string) => notifies.push(m), setStatus() {} },
		};
		await commands.get("release-check")!.handler("", ungovernedCtx);
		expect(notifies.some((m) => m.includes("FOUNDRY_GATE"))).toBe(true);
		expect(existsSync(join(dir, ".omp", "foundry-state.yml"))).toBe(false);
	});
});
