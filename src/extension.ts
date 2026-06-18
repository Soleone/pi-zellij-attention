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

const waitingTools = new Set(["ask_user", "ask_user_question"]);
const readTools = new Set([
	"read",
	"code_search",
	"grep",
	"find",
	"ls",
	"search_output",
	"read_output_chunk",
]);
const editTools = new Set(["edit", "write"]);
const webTools = new Set([
	"web_search",
	"web_search_summary",
	"web_fetch",
	"perplexity_search",
	"perplexity_fetch",
	"fetch_content",
	"get_search_content",
]);

let enabled = false;
let paneId: string | undefined;
let currentEvent: AttentionEvent | undefined;
let didRegisterExitHook = false;

export default function zellijAttentionPiExtension(pi: ExtensionAPI) {
	const unsubscribeGuardReviewPrompt = pi.events.on("guard:review-prompt", () => {
		if (!enabled) return;
		// Guard shows its own approval dialog inside a tool_call handler, so no normal
		// ask_user tool event is emitted. Force the update because the Zellij plugin can
		// demote a focused tab to idle without this process seeing that state change.
		sendAttention("waiting", { force: true });
	});

	pi.on("session_start", async () => {
		configure();
		if (!enabled) return;
		registerExitHook();
		sendAttention("watch");
	});

	pi.on("agent_start", async () => {
		if (!enabled) return;
		sendAttention("thinking");
	});

	pi.on("tool_call", async (event) => {
		if (!enabled) return;
		sendAttention(eventForTool(event.toolName));
	});

	pi.on("tool_execution_update", async (event) => {
		if (!enabled) return;
		sendAttention(eventForTool(event.toolName));
	});

	pi.on("agent_end", async () => {
		if (!enabled) return;
		sendAttention("completed");
	});

	pi.on("session_shutdown", async () => {
		unsubscribeGuardReviewPrompt();
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
	if (waitingTools.has(toolName)) return "waiting";
	if (toolName === "bash") return "bash";
	if (readTools.has(toolName)) return "read";
	if (editTools.has(toolName)) return "edit";
	if (toolName === "subagent") return "subagent";
	if (webTools.has(toolName)) return "web";
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
