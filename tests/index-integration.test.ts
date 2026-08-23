import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ompCompanyWorkflow from "../src/index";
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
	ompCompanyWorkflow(api);
	return { tools, commands, handlers, messages };
}

function ctx(cwd: string) {
	return { cwd, ui: { notify() {}, setStatus() {} }, setTimeout() {}, async waitForIdle() {} };
}

describe("extension integration smoke", () => {
	test("registers canonical tools/commands and no agent-owned lifecycle tools", () => {
		const { tools, commands } = harness();
		expect(tools.has("company_status")).toBe(true);
		expect(tools.has("foundry_skill_read")).toBe(true);
		expect(tools.has("aatp_begin")).toBe(false);
		expect(tools.has("aatp_complete")).toBe(false);
		expect(commands.has("foundry")).toBe(true);
		expect(commands.has("foundry-init")).toBe(true);
		expect(commands.has("foundry-doctor")).toBe(true);
		expect(commands.has("release-check")).toBe(true);
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

	test("design approve handler executes and locks without runtime ReferenceError", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-index-"));
		mkdirSync(join(cwd, "docs"), { recursive: true });
		writeFileSync(join(cwd, "docs", "DESIGN.md"), "# design\n");
		const state = defaultState();
		state.product.status = "approved";
		state.master_plan.status = "locked";
		state.phase = "design";
		state.design.required = true;
		saveState(cwd, state);
		const { commands } = harness();
		await commands.get("design")!.handler("approve", ctx(cwd));
		const after = loadState(cwd);
		expect(after.design.status).toBe("locked");
		expect(after.phase).toBe("aatp");
	});

	test("foundry_exec fails closed outside unlocked design phase", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-exec-"));
		saveState(cwd, defaultState());
		const { tools } = harness();
		const result = await tools.get("foundry_exec")!.execute("1", { id: "build" }, "s", null, ctx(cwd));
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("FOUNDRY_EXEC_GATE");
	});

	test("tool_call blocks legacy lifecycle names", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-hook-"));
		const { handlers } = harness();
		const hook = handlers.get("tool_call")![0];
		const result = await hook({ toolName: "aatp_complete", input: { id: "AATP-1" } }, ctx(cwd));
		expect(result.block).toBe(true);
		expect(result.reason).toContain("LIFECYCLE_GATE");
	});
});