# PLAN: pi-zellij-attention

## Purpose

Create a small pi/zellij integration that helps surface when an agent session needs attention. The goal is to make long-running or background pi sessions easier to monitor from a zellij workspace, especially when subagents or coding tasks pause for input, fail, finish, or otherwise need the user to look back.

## Starting context

This plan was created from the portfolio session after discussing deployment and project review work. The user created this repo/directory:

```txt
/home/soleone/src/pi/pi-zellij-attention
```

At creation time it was empty.

Relevant project/user context:

- User works with `pi` coding agent and zellij.
- User values agent workflows, subagents, always-live/deployable projects, and practical CLI tooling.
- Existing pi-related repos on GitHub include `pi-tasks`, `pi-ext`, `pi-mp`, `pi-intro`, `agent-memory`, and `agent-coach`.
- Main pi docs are available under the installed package if needed:
  - `/home/soleone/.local/share/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.79.2/4d0063303048c65023c63c54802f09d16fc2b1284e1aa96a0f874b6a7a7fdcf2b1284e1aa96a0f874b6a7a7fdcf2/node_modules/@earendil-works/pi-coding-agent/README.md`
  - If that exact store path is stale, locate with `pnpm store path` or `fd pi-coding-agent ~/.local/share/pnpm/store`.

## Problem statement

When running multiple pi sessions inside zellij, it is easy to miss that a pane needs attention. We need a lightweight way to:

1. Detect session states such as done, failed, waiting for input, or needs attention.
2. Surface that state in zellij in an obvious but non-disruptive way.
3. Let the user jump to the relevant pane/session quickly.

## Desired outcome

A working MVP that can be run locally and eventually packaged/reused.

Minimum viable features:

- A command/script that can mark a zellij tab or pane as needing attention.
- A command/script that can clear the attention state.
- A simple integration path from pi events/logs/hooks to that command.
- Documentation with setup and usage.

Nice-to-have features:

- Status indicator in zellij tab name, e.g. `●`, `!`, or `[needs-attention]`.
- Different states: running, done, failed, waiting, needs input.
- Optional desktop notification.
- Optional sound or terminal bell.
- Project/session labels.
- Works across multiple panes/tabs.
- Does not require modifying pi core if an extension/hook/log watcher is enough.

## Research checklist

Start a new session by investigating these in order:

1. Zellij capabilities
   - How to rename current pane/tab from shell.
   - How to query panes/tabs/sessions.
   - Whether plugins can display global status.
   - Relevant commands: `zellij action --help`, `zellij action rename-tab`, `zellij action rename-pane`, `zellij list-sessions`, `zellij setup --dump-config`.

2. Pi event/notification capabilities
   - Check pi docs for extensions, hooks, custom tools, notifications, subagent control events, and session logs.
   - Determine if pi can emit a hook on:
     - task completed
     - needs attention
     - ask_user_question
     - command failed
     - subagent needs attention
   - If not, inspect session/log files for watchable signals.

3. Existing user/pi extensions
   - Look at repos if local copies exist:
     - `/home/soleone/src/pi/pi-tasks`
     - `/home/soleone/src/pi/pi-ext`
     - `/home/soleone/src/pi/pi-mp`
   - Reuse conventions for packaging, commands, and README style.

## Implementation options

### Option A: Shell scripts first

Create a minimal shell CLI:

```bash
pi-zellij-attention mark --state needs-attention --label portfolio
pi-zellij-attention clear
pi-zellij-attention done
pi-zellij-attention failed
```

Internally it can rename the current tab/pane via zellij actions.

Pros:
- Fastest MVP.
- Easy to test manually.
- No pi internals required.

Cons:
- Needs a separate bridge from pi events.

### Option B: Log watcher

Create a watcher process that tails pi session logs and calls the shell CLI when it sees state changes.

Pros:
- Can work without changing pi.
- Useful for existing sessions.

Cons:
- Log formats can change.
- Needs careful false-positive handling.

### Option C: Pi extension/hook

Create a pi extension that emits zellij updates directly on relevant lifecycle events.

Pros:
- Cleanest long-term UX.
- Can use structured state if pi exposes it.

Cons:
- Requires reading pi extension docs and maybe more implementation time.

Recommended path:

1. Build Option A as a manual CLI.
2. Add Option B or C after confirming the best pi integration point.

## Suggested repo structure

```txt
/home/soleone/src/pi/pi-zellij-attention/
  PLAN.md
  README.md
  package.json or just scripts/
  scripts/
    pi-zellij-attention
  src/
    index.ts           # if TypeScript CLI
  examples/
    manual-demo.md
```

If keeping it ultra-lightweight, start with just:

```txt
scripts/pi-zellij-attention
README.md
```

## MVP acceptance criteria

- Running a command from inside zellij visibly changes the current pane or tab to show attention.
- Running a clear command restores/removes the marker.
- The README documents install/use steps.
- Behavior is safe if not running inside zellij: it should print a clear message and exit non-zero or no-op gracefully.
- No hardcoded user-specific paths unless documented as examples.

## Initial manual test commands

From inside a zellij pane:

```bash
zellij action rename-tab "● needs attention"
zellij action rename-pane "portfolio: waiting"
zellij action rename-tab "portfolio"
```

Outside zellij, verify detection:

```bash
echo "$ZELLIJ"
echo "$ZELLIJ_SESSION_NAME"
```

## Open questions

- Should attention be shown on the tab, pane, or both?
- What exact symbols/colors does zellij support in tab names?
- Can zellij plugins set colors/status independently from names?
- Does pi expose structured lifecycle hooks already?
- Should this live as a standalone repo, a pi extension, a zellij plugin, or a hybrid?

## Related future idea

If this works well, integrate with pi subagent control events so a long-running parent session can surface:

- `active_long_running`
- `needs_attention`
- completed child run
- failed child run

This would pair well with workflows where pi runs multiple agents or deploy/test loops in the background.
