# pi-zellij-attention

A pi extension that sends pi lifecycle/tool events to the standalone `zellij-attention` Zellij plugin.

Important: this extension does **not** rename tabs itself. It uses the plugin's `watch`/status pipe protocol, so the Zellij plugin owns tab icon rendering, target pane mapping, and focus-to-idle behavior.

## Requirements

Install and load the Zellij plugin from:

```txt
$SRC/opensource/zellij-attention
```

The plugin should be configured with `clear_on_tab_focus "true"` if you want completed/waiting/tool states to demote back to idle when you focus the tab.

If icons do not appear, verify that the background plugin is actually running in the current Zellij session. Existing or resurrected sessions may need a manual plugin reload.

## Install

Use as a local extension while developing:

```bash
pi -e ./index.ts
```

Or install globally for all pi sessions:

```bash
mkdir -p ~/.pi/agent/extensions/pi-zellij-attention
ln -sf "$PWD/index.ts" ~/.pi/agent/extensions/pi-zellij-attention/index.ts
ln -sfn "$PWD/src" ~/.pi/agent/extensions/pi-zellij-attention/src
```

Then run `/reload` in pi, or start a new pi session.

## Behavior

On `session_start`, the extension sends:

```bash
zellij pipe --name "zellij-attention::watch::$ZELLIJ_PANE_ID" -- "pi"
```

After that, it sends plugin events:

- `agent_start` → `thinking`
- `bash` tool → `bash`
- `read` / `code_search` tools → `read`
- `edit` / `write` tools → `edit`
- `subagent` tool → `subagent`
- web tools → `web`
- `ask_user` / `ask_user_question` → `waiting`
- Guard extension `guard:review-prompt` event → `waiting`
- `agent_end` → `completed`
- `session_shutdown` / process exit → `unwatch`

Because the pane is watched, the Zellij plugin should show idle (`○`) when focused instead of leaving `✓` stuck on the tab.

The extension treats normal status pipe delivery as best-effort and fire-and-forget. Shutdown/unwatch uses a short synchronous send so the idle icon is removed more reliably when pi exits. Repeated identical states are skipped to reduce unnecessary tab renames/flicker, except for guard review prompts where the update is forced because focusing a tab can demote the plugin state to idle without pi seeing that state change.

## Command

The extension registers `/zellij-attention`:

```txt
/zellij-attention status
/zellij-attention watch
/zellij-attention clear
/zellij-attention unwatch
/zellij-attention mark waiting
/zellij-attention mark completed
```

## Package format

This repo is a pi extension package:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
