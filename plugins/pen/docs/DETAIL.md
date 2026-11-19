# Pen design tools

Turns the always-on pen (pencil) MCP configuration into a checkbox that only
exists on a new session.

The usual way to mount an MCP server in DSH is a row in the profile's
`cordis.patch.yml` (`@deepseek-ai/dsh-mcp-client`). It starts with DSH, every
session sees `mcp__pencil__*`, and a Pen process stays alive all the time. This
plugin moves the decision to the **session**: when you create a new session and
tick “Pen” (the checkbox shows the Pen logo before its label), that session gets the Pen tools; unticked sessions never see
them and never spawn Pen.

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
   but every ticked session then starts its own Pen process next to the global
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
- A failed connection (for example Pen.app is not at the default path) never
  blocks the session: the error is logged and the session simply has no Pen
  tools. The tooltip shows the reason.

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

- The tick lives in **Host process memory**: it survives page reloads and
  session switching, but not a DSH restart. A session that already sent a
  message no longer shows the New Session row, so a resumed session does not
  reconnect Pen automatically. Tick it on a fresh session instead.
- One ticked session owns one Pen MCP child process; several ticked sessions
  start several processes in parallel.
- The checkbox only appears in the New Session row, next to the official
  worktree checkbox; it disappears once the session starts.
- The tools are registered in the session's Agent scope only, so they never
  appear in other sessions' tool lists.

## Security

The Host registers just two local routes (`/buka-pen/state`,
`/buka-pen/toggle`) behind DSH's web trust gate
(`connection.requestRejection`): requests from other origins or unauthenticated
clients are rejected. Bodies are capped at 16 KiB, and `sessionId` is only used
to look up the Host's own state table — never as a file path or command
fragment.
