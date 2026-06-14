import { spawn, spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type AttentionEvent =
	| "watch"
	| "unwatch"
	| "clear"
	| "thinking"
	| "bash"
	| "read"
	| "edit"
	| "subagent"
	| "web"
	| "other"
	| "waiting"
	| "completed";

let enabled = false;
let paneId: string | undefined;
let sawToolError = false;
let currentEvent: AttentionEvent | undefined;
let didRegisterExitHook = false;

export default function zellijAttentionPiExtension(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		configure();
		if (!enabled) return;
		registerExitHook();
		sendAttention("watch");
	});

	pi.on("agent_start", async () => {
		if (!enabled) return;
		sawToolError = false;
		sendAttention("thinking");
	});

	pi.on("tool_call", async (event) => {
		if (!enabled) return;
		sendAttention(eventForTool(event.toolName));
	});

	pi.on("tool_result", async (event) => {
		if (!enabled) return;
		if (event.isError) sawToolError = true;
	});

	pi.on("agent_end", async () => {
		if (!enabled) return;
		sendAttention(sawToolError ? "waiting" : "completed");
	});

	pi.on("session_shutdown", async () => {
		if (!enabled) return;
		sendAttentionSync("unwatch");
	});

	pi.registerCommand("zellij-attention", {
		description: "Control zellij-attention plugin: status | watch | clear | unwatch | mark <event>",
		handler: async (args, ctx) => {
			configure();
			const [cmd = "status", event = "waiting"] = args.trim().split(/\s+/).filter(Boolean);
			if (!enabled) {
				ctx.ui.notify("zellij-attention disabled: missing ZELLIJ or ZELLIJ_PANE_ID", "info");
				return;
			}

			if (cmd === "watch" || cmd === "clear" || cmd === "unwatch") {
				sendAttention(cmd, { force: true });
				ctx.ui.notify(`zellij-attention: ${cmd}`, "info");
				return;
			}

			if (cmd === "mark") {
				sendAttention(event as AttentionEvent, { force: true });
				ctx.ui.notify(`zellij-attention: ${event}`, "info");
				return;
			}

			ctx.ui.notify(`zellij-attention enabled for pane ${paneId}`, "info");
		},
	});
}

function configure() {
	paneId = process.env.ZELLIJ_PANE_ID;
	enabled = Boolean(process.env.ZELLIJ && paneId);
}

function registerExitHook() {
	if (didRegisterExitHook) return;
	didRegisterExitHook = true;
	process.once("exit", () => sendAttentionSync("unwatch"));
}

function eventForTool(toolName: string): AttentionEvent {
	if (toolName === "ask_user_question") return "waiting";
	if (toolName === "bash") return "bash";
	if (toolName === "read" || toolName === "code_search") return "read";
	if (toolName === "edit" || toolName === "write") return "edit";
	if (toolName === "subagent") return "subagent";
	if (toolName === "web_search" || toolName === "fetch_content" || toolName === "get_search_content") return "web";
	return "other";
}

function sendAttention(event: AttentionEvent, options: { force?: boolean } = {}) {
	if (!paneId) return;
	if (!options.force && currentEvent === event) return;
	currentEvent = event;
	const child = spawn(
		"zellij",
		pipeArgs(event),
		{ stdio: "ignore", detached: true },
	);
	child.unref();
}

function sendAttentionSync(event: AttentionEvent) {
	if (!paneId) return;
	currentEvent = event;
	spawnSync("zellij", pipeArgs(event), {
		stdio: "ignore",
		timeout: 1_000,
	});
}

function pipeArgs(event: AttentionEvent) {
	return ["pipe", "--name", `zellij-attention::${event}::${paneId}`, "--", "pi"];
}
