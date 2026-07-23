# pi-zellij-attention

A pi extension that sends pi lifecycle/tool events to the standalone `zellij-attention` Zellij plugin.

Important: this extension does **not** rename tabs itself. It uses the plugin's `watch`/status pipe protocol, so the Zellij plugin owns tab icon rendering, target pane mapping, and focus-to-idle behavior.

## Requirements

Install and load the standalone [`zellij-attention`](https://github.com/soleone/zellij-attention) Zellij plugin.

The plugin should be configured with `clear_on_tab_focus "true"` if you want completed/waiting/tool states to demote back to idle when you focus the tab.

Quick-start icon configuration to copy into `~/.config/zellij/config.kdl`:

```kdl
load_plugins {
    "file:~/.config/zellij/plugins/zellij-attention.wasm" {
        enabled "true"
        thinking_icon "●"
        bash_icon "⚡"
        read_icon "◉"
        edit_icon "✎"
        subagent_icon "⊜"
        web_icon "◈"
        other_icon "⚙"
        waiting_icon "▶"
        completed_icon "✓"
        idle_icon "○"
        clear_on_tab_focus "true"
    }
}
```

If icons do not appear, verify that the background plugin is actually running in the current Zellij session. Existing or resurrected sessions may need a manual plugin reload. To reload manually with the same defaults:

```bash
zellij action start-or-reload-plugin \
  'file:~/.config/zellij/plugins/zellij-attention.wasm' \
  --configuration 'enabled=true,thinking_icon=●,bash_icon=⚡,read_icon=◉,edit_icon=✎,subagent_icon=⊜,web_icon=◈,other_icon=⚙,waiting_icon=▶,completed_icon=✓,idle_icon=○,clear_on_tab_focus=true'
```

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
- A blocking extension dialog actually opening (`herdr:blocked` with `active: true`, including Guard approval) → `waiting`
- `agent_end` → `completed`
- `session_shutdown` / process exit → `unwatch`

Because the pane is watched, the Zellij plugin should show idle (`○`) when focused instead of leaving `✓` stuck on the tab.

The extension sends at most one status pipe at a time so events cannot overtake each other. If Zellij is slow, queued transient states are coalesced to the newest status, and every pipe is terminated after one second to prevent leaked `zellij pipe` processes. Shutdown cancels pending delivery and sends `unwatch` synchronously so a late tool state cannot overwrite the cleanup event. Repeated identical states are skipped to reduce unnecessary tab renames/flicker, except for actual blocking prompts where the update is forced because focusing a tab can demote the plugin state to idle without pi seeing that state change.

Guard's internal vote and explainer/recast passes do not trigger `waiting` or play a sound. The state changes only if Guard finishes those automatic checks and opens a dialog that genuinely requires user approval.

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
