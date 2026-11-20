# SKILL update notice

Warns you at the bottom left of the New Session composer when the project
skills in the current workspace have upstream updates. It only reports; it
never updates anything.

The check uses the CLI shipped by the `skills` package — the same
implementation behind `npx skills` — reads the workspace's `skills-lock.json`,
and runs `check -p`. The plugin declares `skills` as a runtime dependency, so
installing the bundle installs the CLI too. The Buka Skills plugin is not
required.

## What you see

- On a new session, the bottom left of the composer tool row shows
  `N skill updates` in the DSH warn colour (`--dsw-alias-state-warn-primary`).
- Hovering lists the first few skill names and tells you to click to recheck.
- Clicking skips the five-minute cache and checks again. Nothing is rendered
  when everything is up to date, when the workspace has no project skills, or
  while the first check is still running.
- A failed check collapses to a small `!` in the error colour; the tooltip
  gives the reason, and clicking retries.

## How the check works

1. The browser sends only the current session id to the Host.
2. The Host resolves the current workspace directory from `sessions` and
   `workspaceRegistry`: it prefers the workspace whose `sessionIds` contains
   the session, and otherwise falls back to the session header's `cwd` plus the
   longest registered workspace path that contains it.
3. It reads `<workspace>/skills-lock.json`. Without that file the workspace has
   no project skills managed by `npx skills`, so the check stops before
   spawning the CLI.
4. It runs `check -p -y` with the `skills` CLI from the plugin dependency.
   Exit codes 0 and 1 are both normal conclusions; 1 means updates or local
   changes exist.
5. Only `↑ <name> has an update` counts as an update. Local changes
   (`✎ … has local changes`) do not raise the warning.

One workspace runs the CLI at most once per five minutes; sessions mounted at
the same time share the in-flight request. The check is read-only: it does not
rewrite the lock file and does not install or update any skill.

## Updating

The plugin deliberately does not update anything. After you decide to update:

```bash
# In the current workspace
npx skills update -p

# Or one skill only
npx skills update <skill-name> -p
```

You can also keep using the [Skills plugin](../skills/README.md) page. Click
the composer warning afterwards to recheck; it disappears once the workspace
is up to date.

## Limits

- Project skills only (the workspace's `skills-lock.json`). Global skills under
  `~/.agents/skills` are outside this prompt; the Skills plugin covers them.
- A workspace without `skills-lock.json` has nothing to check. Skills installed
  by hand and missing from the lock are not included.
- No polling: the check runs when the composer mounts or the session changes;
  after that it runs when you click the prompt.
- The first check may contact the skill sources and take seconds or tens of
  seconds. The prompt does not occupy space while it runs.
- The prompt lives in `conversation.input.left` (the left side of the composer
  tool row). It needs a session; a blank New Session has an id and works.

## Requirements

- DSH `>= 0.2.2-rc.1`.
- The bundle installs `skills@1.9.0`; `@buka/dsh-plugin-skills` is not
  required.
- The Host needs the `sessions` service. `workspaceRegistry` is optional; without
  it the plugin falls back to the session `cwd`.

## Security

The Host registers one local route (`GET /buka-skill-update-check/status`) behind
DSH's web trust gate (`connection.requestRejection`): requests from other
origins or unauthenticated clients are rejected. The browser can send only a
session id and `refresh=1`, never a path; the Host derives the directory from
its own session and workspace records.

See [`docs/DETAIL.md`](docs/DETAIL.md) for the full description (Chinese:
[`docs/DETAIL.zh.md`](docs/DETAIL.zh.md)).
