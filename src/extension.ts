import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
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

const PIPE_TIMEOUT_MS = 1_000;

export default function zellijAttentionPiExtension(pi: ExtensionAPI) {
	const delivery = createAttentionDelivery();
	const unsubscribeBlocked = pi.events.on("herdr:blocked", (data) => {
		if (!delivery.enabled || !isActiveBlockedSignal(data)) return;
		// Guard emits this only when its approval dialog actually opens, after internal
		// voting and any automatic recast have finished. Force the update because the
		// Zellij plugin can demote a focused tab without this process seeing the change.
		delivery.send("waiting", { force: true });
	});

	pi.on("session_start", async () => {
		delivery.start();
	});

	pi.on("agent_start", async () => {
		if (!delivery.enabled) return;
		delivery.send("thinking");
	});

	pi.on("tool_call", async (event) => {
		if (!delivery.enabled) return;
		delivery.send(eventForTool(event.toolName));
	});

	pi.on("tool_execution_update", async (event) => {
		if (!delivery.enabled) return;
		delivery.send(eventForTool(event.toolName));
	});

	pi.on("agent_end", async () => {
		if (!delivery.enabled) return;
		delivery.send("completed");
	});

	pi.on("session_shutdown", async () => {
		unsubscribeBlocked();
		delivery.stop();
	});

	pi.registerCommand("zellij-attention", {
		description: "Control zellij-attention plugin: status | watch | clear | unwatch | mark <event>",
		handler: async (args, ctx) => {
			delivery.configure();
			const [cmd = "status", event = "waiting"] = args.trim().split(/\s+/).filter(Boolean);
			if (!delivery.enabled) {
				ctx.ui.notify("zellij-attention disabled: missing ZELLIJ or ZELLIJ_PANE_ID", "info");
				return;
			}

			if (cmd === "watch" || cmd === "clear" || cmd === "unwatch") {
				delivery.send(cmd, { force: true });
				ctx.ui.notify(`zellij-attention: ${cmd}`, "info");
				return;
			}

			if (cmd === "mark") {
				delivery.send(event as AttentionEvent, { force: true });
				ctx.ui.notify(`zellij-attention: ${event}`, "info");
				return;
			}

			ctx.ui.notify(`zellij-attention enabled for pane ${delivery.paneId}`, "info");
		},
	});
}

function isActiveBlockedSignal(data: unknown): boolean {
	return typeof data === "object" && data !== null && "active" in data && data.active === true;
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

function createAttentionDelivery() {
	let enabled = false;
	let paneId: string | undefined;
	let currentEvent: AttentionEvent | undefined;
	let pendingEvent: AttentionEvent | undefined;
	let activePipe: ChildProcess | undefined;
	let deliveryStopped = false;
	let didRegisterExitHook = false;
	let didSendUnwatch = false;

	const handleProcessExit = () => unwatchSync();

	function configure() {
		paneId = process.env.ZELLIJ_PANE_ID;
		enabled = Boolean(process.env.ZELLIJ && paneId);
	}

	function start() {
		configure();
		if (!enabled) return;

		resetDelivery();
		registerExitHook();
		send("watch");
	}

	function stop() {
		unwatchSync();
		unregisterExitHook();
	}

	function resetDelivery() {
		activePipe?.kill();
		activePipe = undefined;
		pendingEvent = undefined;
		currentEvent = undefined;
		deliveryStopped = false;
		didSendUnwatch = false;
	}

	function registerExitHook() {
		if (didRegisterExitHook) return;
		didRegisterExitHook = true;
		process.once("exit", handleProcessExit);
	}

	function unregisterExitHook() {
		if (!didRegisterExitHook) return;
		didRegisterExitHook = false;
		process.removeListener("exit", handleProcessExit);
	}

	function send(event: AttentionEvent, options: { force?: boolean } = {}) {
		if (!paneId || deliveryStopped) return;
		if (!options.force && currentEvent === event) return;
		currentEvent = event;

		// Only one CLI pipe may be in flight at a time. This preserves event order,
		// while replacing queued transient states with the newest status avoids a
		// backlog when Zellij or the plugin is slow.
		pendingEvent = event;
		flushPendingEvent();
	}

	function flushPendingEvent() {
		if (!paneId || deliveryStopped || activePipe || !pendingEvent) return;

		const event = pendingEvent;
		pendingEvent = undefined;
		const child = spawn("zellij", pipeArgs(event), {
			stdio: "ignore",
			timeout: PIPE_TIMEOUT_MS,
		});
		activePipe = child;

		const finish = () => {
			if (activePipe !== child) return;
			activePipe = undefined;
			flushPendingEvent();
		};
		child.once("error", finish);
		child.once("exit", finish);
	}

	function stopAsyncDelivery() {
		deliveryStopped = true;
		pendingEvent = undefined;
		activePipe?.kill();
		activePipe = undefined;
	}

	function unwatchSync() {
		if (!enabled || !paneId || didSendUnwatch) return;
		didSendUnwatch = true;
		stopAsyncDelivery();
		sendSync("unwatch");
	}

	function sendSync(event: AttentionEvent) {
		if (!paneId) return;
		currentEvent = event;
		spawnSync("zellij", pipeArgs(event), {
			stdio: "ignore",
			timeout: PIPE_TIMEOUT_MS,
		});
	}

	function pipeArgs(event: AttentionEvent) {
		return ["pipe", "--name", `zellij-attention::${event}::${paneId}`, "--", "pi"];
	}

	return {
		get enabled() {
			return enabled;
		},
		get paneId() {
			return paneId;
		},
		configure,
		start,
		stop,
		send,
	};
}
