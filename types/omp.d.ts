declare module "@oh-my-pi/pi-coding-agent" {
	export interface ExtensionContext {
		cwd: string;
		ui: {
			notify(message: string, level?: "info" | "warning" | "error"): void;
			setStatus(key: string, value: string): void;
		};
		setTimeout(callback: () => void, ms: number): void;
		waitForIdle(): Promise<void>;
	}

	export interface ToolResult {
		content: Array<{ type: string; text: string }>;
		details?: unknown;
		isError?: boolean;
	}

	export interface ToolCallEvent {
		toolName: string;
		input?: unknown;
		toolCallId?: string;
	}
	export interface ToolResultEvent extends ToolCallEvent {
		content?: unknown;
		details?: unknown;
		isError?: boolean;
	}
	export interface AgentStartEvent {
		agentName?: string;
		agent?: { name?: string };
	}

	export interface ToolDefinition<P = any> {
		name: string;
		label?: string;
		description?: string;
		loadMode?: string;
		approval?: string;
		parameters: unknown;
		execute: (id: string, params: P, sessionId: string, user: unknown, ctx: ExtensionContext) => ToolResult | Promise<ToolResult>;
		[key: string]: unknown;
	}

	type MaybePromise<T> = T | Promise<T>;
	export interface ExtensionAPI {
		zod: any;
		setLabel(label: string): void;
		sendUserMessage(text: string): void;
		on(event: "session_start", handler: (event: unknown, ctx: ExtensionContext) => MaybePromise<void>): void;
		on(event: "before_agent_start", handler: (event: AgentStartEvent, ctx: ExtensionContext) => MaybePromise<unknown>): void;
		on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => MaybePromise<unknown>): void;
		on(event: "tool_result", handler: (event: ToolResultEvent, ctx: ExtensionContext) => MaybePromise<unknown>): void;
		registerTool<P = any>(tool: ToolDefinition<P>): void;
		registerCommand(name: string, config: { description: string; handler: (args: string, ctx: ExtensionContext) => void | Promise<void> }): void;
	}
}

declare module "@oh-my-pi/pi-utils/dirs" {
	export const VERSION: string | undefined;
	export function getFastembedCacheDir(): string;
}
