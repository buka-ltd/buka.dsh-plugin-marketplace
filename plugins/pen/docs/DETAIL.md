# Pen design tools

Turns the always-on pen (pencil) MCP configuration into a per-session switch:
tick “Pen” when the session is new, or send `/pen` / `/pen off` at any point
during the session. Enabled sessions show a “Pen MCP” mark beside the title.

The usual way to mount an MCP server in DSH is a row in the profile's
`cordis.patch.yml` (`@deepseek-ai/dsh-mcp-client`). It starts with DSH, every
session sees `mcp__pencil__*`, and a Pen process stays alive all the time. This
plugin moves the decision to the **session**: when you create a new session and
tick “Pen” (the checkbox shows the Pen logo before its label), that session gets the Pen tools; unticked sessions never see
them and never spawn Pen. Once the session starts the checkbox is gone and a
plain “Pen MCP” label with an outline icon appears beside the title, confirming
that the session has Pen enabled. If you discover mid-conversation that you
need Pen, there is no need to open another session: send `/pen` to switch it on
and `/pen off` to switch it off.

## Install

1. Install `Pen` (`@buka/dsh-plugin-pen`) from Plugins → Discover.
2. Remove the old pen MCP row from your profile, or it keeps running globally:

   ```yaml
   # ~/.dsh/profiles/<profile>/cordis.patch.yml
   - insert:
       - id: mcp-pencil
         name: "@deepseek-ai/dsh-mcp-client"
         config:
           serverName: pencil
           transport: stdio
           command: /Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64
           args: [ "--app", "desktop" ]
   ```

   Restart DSH (or reload the profile) afterwards. Keeping the row also works,
   but every enabled session then starts its own Pen process next to the global
   one.
3. Start a new session, tick “Pen” at the top right (after the workspace and
   preset controls), and send a message.

## What a tick does

- When the session starts, the Host half mounts a `@deepseek-ai/dsh-mcp-client`
  inside **that session's Agent scope**. Its tools are named
  `mcp__pencil__<tool>` and are visible only to that session; other sessions and
  subagents do not inherit them.
- The tick happens before the Agent exists (blank session). The plugin remembers
  the session id and connects on `agent/created`; that event waits for its
  listeners, so the **first message already sees the Pen tools** (it waits for
  the connection and tool list, up to 20 s by default).
- Unticking disconnects immediately and unregisters the tools. Agent disposal
  disconnects too.
- Once the session starts, a plain “Pen MCP” label (outline icon plus the brand
  name) sits beside the title, between the title and the official action
  buttons. It only states that the session has Pen enabled: it has no hover
  explanation. Use `/pen off` to switch Pen off.
- A failed connection (for example Pen.app is not at the default path) never
  blocks the session: the error is logged and the session simply has no Pen
  tools. The tooltip shows the reason.

## Switching during a session

Two slash commands work at any point of an existing session and act exactly like
the checkbox — they only touch the current session:

- `/pen` (or `/pen on`): enable and connect.
- `/pen off`: disable and disconnect.

They run directly in the UI, never as model messages, and their result comes
back as a command card that says whether the tools are ready (with the failure
reason when the connection fails).

One timing detail: the tool list is assembled before each model request, so Pen
enabled mid-session becomes visible to the model from the **next** message; the
turn that is currently generating does not gain tools halfway through. Disabling
is immediate — a Pen tool call in flight at that moment fails.

The “Pen MCP” mark refreshes with the command result: it appears after a
successful `/pen` and disappears after `/pen off`, without a page reload.

## Configuration

The plugin settings expose the fields of a stdio `dsh-mcp-client` entry:

| Field               | Default                                              | Meaning                                                |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `serverName`        | `pencil`                                             | Tool-name prefix: `mcp__<serverName>__`                |
| `command`           | Pen.app's bundled `mcp-server-darwin-arm64` on macOS | stdio executable                                       |
| `args`              | `["--app", "desktop"]`                               | Arguments passed to the executable                     |
| `env`               | `{}`                                                 | Extra variables merged over DSH's scrubbed environment |
| `cwd`               | `""` (inherit)                                       | Child working directory                                |
| `toolCallTimeoutMs` | `60000`                                              | Per-tool-call timeout                                  |
| `startupTimeoutMs`  | `20000`                                              | Budget for the first connection plus tool discovery    |

`command` is the only platform-specific value: point it at the right
executable when Pen lives elsewhere or you are not on macOS arm64.

## State and limits

- The switch lives in **Host process memory**: it survives page reloads and
  session switching, but not a DSH restart. A session that already sent a
  message no longer shows the New Session row, so a resumed session does not
  reconnect Pen automatically — send `/pen` in it to switch Pen back on.
- One enabled session owns one Pen MCP child process; several enabled sessions
  start several processes in parallel.
- The checkbox only appears in the New Session row, next to the official
  worktree checkbox; it disappears once the session starts, and the “Pen MCP”
  label beside the title then shows that the session has Pen enabled.
- The tools are registered in the session's Agent scope only, so they never
  appear in other sessions' tool lists.
- When the profile does not compose the `commands` service, `/pen` and
  `/pen off` are unavailable; the checkbox is unaffected.

## Security

The Host registers just two local routes (`/pen/state`,
`/pen/toggle`) behind DSH's web trust gate
(`connection.requestRejection`): requests from other origins or unauthenticated
clients are rejected. Bodies are capped at 16 KiB, and `sessionId` is only used
to look up the Host's own state table — never as a file path or command
fragment. `/pen` and `/pen off` go through DSH's command registry, whose only
arguments are `on` and `off`; no arbitrary command or path is accepted.
