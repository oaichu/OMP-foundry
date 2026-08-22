// Minimal ambient shapes for the OMP extension host APIs. The real packages
// are provided by the Oh My Pi runtime, not npm, so typecheck runs against
// these declarations instead.
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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export interface ToolDefinition<P = any> {
		name: string;
		label?: string;
		description?: string;
		loadMode?: string;
		approval?: string;
		parameters: unknown;
		execute: (
			id: string,
			params: P,
			sessionId: string,
			user: unknown,
			ctx: ExtensionContext,
		) => ToolResult | Promise<ToolResult>;
		[key: string]: unknown;
	}

	export interface ExtensionAPI {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		zod: any;
		setLabel(label: string): void;
		sendUserMessage(text: string): void;
		on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;
		registerTool(tool: ToolDefinition): void;
		registerCommand(name: string, config: { description: string; handler: (args: string, ctx: ExtensionContext) => void | Promise<void> }): void;
	}
}

declare module "@oh-my-pi/pi-utils/dirs" {
	export const VERSION: string | undefined;
	export function getFastembedCacheDir(): string;
}
