import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import zellijAttentionPiExtension from "../src/extension.ts";

type Handler = (...args: any[]) => unknown;

function createPiHarness() {
	const handlers = new Map<string, Handler[]>();
	const eventHandlers = new Map<string, Handler[]>();

	const pi = {
		on(event: string, handler: Handler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		events: {
			on(event: string, handler: Handler) {
				const registered = eventHandlers.get(event) ?? [];
				registered.push(handler);
				eventHandlers.set(event, registered);
				return () => {
					eventHandlers.set(event, registered.filter((candidate) => candidate !== handler));
				};
			},
		},
		registerCommand() {},
	};

	return {
		pi,
		async emit(event: string, data: unknown = {}) {
			for (const handler of handlers.get(event) ?? []) {
				await handler(data);
			}
		},
	};
}

async function readEvents(logPath: string) {
	try {
		const contents = await readFile(logPath, "utf8");
		return contents.trim().split("\n").filter(Boolean);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function waitForEvents(logPath: string, count: number) {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const events = await readEvents(logPath);
		if (events.length >= count) return events;
		await delay(10);
	}
	return readEvents(logPath);
}

test("starts watching again after a session runtime is replaced", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-zellij-attention-"));
	const executable = join(directory, "zellij");
	const logPath = join(directory, "events.log");
	const originalEnv = {
		PATH: process.env.PATH,
		ZELLIJ: process.env.ZELLIJ,
		ZELLIJ_PANE_ID: process.env.ZELLIJ_PANE_ID,
		ZELLIJ_ATTENTION_TEST_LOG: process.env.ZELLIJ_ATTENTION_TEST_LOG,
	};

	await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ZELLIJ_ATTENTION_TEST_LOG"\n');
	await chmod(executable, 0o755);
	process.env.PATH = `${directory}:${originalEnv.PATH ?? ""}`;
	process.env.ZELLIJ = "1";
	process.env.ZELLIJ_PANE_ID = "42";
	process.env.ZELLIJ_ATTENTION_TEST_LOG = logPath;

	let replacement: ReturnType<typeof createPiHarness> | undefined;
	try {
		const initial = createPiHarness();
		zellijAttentionPiExtension(initial.pi as never);
		await initial.emit("session_start");
		assert.equal((await waitForEvents(logPath, 1)).length, 1);

		await initial.emit("session_shutdown");
		replacement = createPiHarness();
		zellijAttentionPiExtension(replacement.pi as never);
		await replacement.emit("session_start");
		await replacement.emit("agent_start");

		const events = await waitForEvents(logPath, 4);
		assert.deepEqual(events.slice(0, 4), [
			"pipe --name zellij-attention::watch::42 -- pi",
			"pipe --name zellij-attention::unwatch::42 -- pi",
			"pipe --name zellij-attention::watch::42 -- pi",
			"pipe --name zellij-attention::thinking::42 -- pi",
		]);
	} finally {
		await replacement?.emit("session_shutdown");
		for (const [name, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(directory, { recursive: true, force: true });
	}
});
