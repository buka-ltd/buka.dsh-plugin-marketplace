# SKILL update notice

Warns you below the New Session composer, at the right end of the statistics
row (after the "context used" ring), when the project skills in the current
workspace have upstream updates. Clicking the warning opens a **SKILL updates**
dialog that lists the outdated project skills with one "Update" button per row
and an "Update all" button in the footer.

Both the check and the update use the CLI shipped by the `skills` package — the
same implementation behind `npx skills` — and read the workspace's
`skills-lock.json`: the check runs `check -p`, an update runs
`update <name> -p`. The plugin declares `skills` as a runtime dependency, so
installing the bundle installs the CLI too. The Buka Skills plugin is not
required.

## What you see

- On a new session, the right end of the statistics row below the composer card
  (after the "context used" ring) shows `N skill updates` in the DSH warn
  colour (`--dsw-alias-state-warn-primary`).
- Hovering lists the first few skill names and tells you to click to review and
  update.
- Each row in the dialog shows the skill name and the source repository
  recorded in `skills-lock.json` (for example `mattpocock/skills`). Skills
  without a recorded source show only the name. The dialog does not repeat the
  workspace path or add a generic description paragraph.
- Clicking opens the dialog. Nothing is rendered when everything is up to date,
  when the workspace has no project skills, or while the first check is still
  running.
- A failed check collapses to a small `!` in the error colour; the tooltip
  gives the reason, and clicking still opens the dialog, where you can check
  again.

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
5. It parses `↑ <name> has an update` and `✎ <name> has local changes`.
   **A locally modified skill never counts as updatable**: even if upstream also
   changed, it stays out of the list and the dialog reports it as
   "Local changes — not updated", so an update cannot overwrite your edits.

One workspace runs the check CLI at most once per five minutes; sessions mounted
at the same time share the in-flight request. Opening the dialog renders the
snapshot the badge already has, and only starts a background check once that
snapshot is older than five minutes; only "Check again" sends `refresh=1` to
skip the cache. The check is read-only.

## How updates work

1. Click the composer warning. The dialog opens instantly with the snapshot the
   badge already has — no second check, no loading state. If that snapshot is
   older than the cache window, the dialog refreshes it in the background while
   keeping the old list visible. Each row has an "Update" button on the right;
   the footer has "Update all".
2. A row sends just that skill name. "Update all" sends every name currently in
   the list; the Host also accepts an omitted list meaning everything the check
   found.
3. The Host resolves the workspace and forces one fresh check, then intersects
   the requested names with the ones that really have updates. Names that are
   already current, missing from `skills-lock.json`, or locally modified are
   never passed to the CLI.
4. The Host runs `skills update <name> -p -y` for each selected skill with the
   workspace as cwd. Updates inside one plugin instance run serially (the CLI
   rewrites the whole lock file, so they cannot overlap), and one failure does
   not stop the rest.
5. Afterwards the Host drops the workspace's check cache and checks once more,
   returning the new snapshot with the response. The dialog refreshes its list
   and the warning count from it without another check request; failed skills
   stay in the list with their reason.
6. When everything was updated and the list is empty, the dialog says all
   project skills are up to date and the composer warning disappears. That
   sentence appears only when the check really concluded "all current"; a
   workspace with nothing to check shows "Nothing to check" with the reason.
7. Updates run in the background: the request lives in a page-level update
   store, so closing the dialog never cancels it. The composer warning switches
   to "Updating N skills", shows "Updated N skills" briefly when it finishes,
   and then counts the new snapshot. Reopening the dialog shows the running
   state and the result; a single-skill update marks its row "Updating…", a
   batch says "Updating N skills…" plus "It keeps running in the background;
   you can close this dialog."

You can also keep using the [Skills plugin](../skills/README.md) page. Both
plugins use the same CLI, and either update is picked up by the next check.

## Limits

- Project skills only (the workspace's `skills-lock.json`). Global skills under
  `~/.agents/skills` are outside this prompt; the Skills plugin covers them.
- A workspace without `skills-lock.json` has nothing to check. Skills installed
  by hand and missing from the lock are not included.
- No polling: the check runs when the composer mounts or the session changes;
  after that it runs when you open the dialog or press "Check again".
- The first check may contact the skill sources and take seconds or tens of
  seconds. The prompt does not occupy space while it runs.
- An update rewrites the workspace's `skills-lock.json` and the skill
  directories under `.agents/skills/` (the CLI does the writing) with no
  second confirmation: pressing the button runs it. Locally modified skills are
  filtered out; for the rest, a clean workspace is still recommended.
- The prompt lives in `conversation.composer.dock` (the statistics row below the
  composer card) and uses flex `order` to sit after the "context used" ring;
  when the ring is hidden it still takes the row's right end. It needs a
  session; a blank New Session has an id and works.
- The prompt only counts upstream updates. A locally modified skill with no
  upstream change does not raise it.

## Requirements

- DSH `>= 0.2.2-rc.1`.
- The bundle installs `skills@1.9.0`; `@buka/dsh-plugin-skills` is not
  required.
- The Host needs the `sessions` service. `workspaceRegistry` is optional; without
  it the plugin falls back to the session `cwd`.

## Security

The Host registers two local routes behind DSH's web trust gate
(`connection.requestRejection`): requests from other origins or unauthenticated
clients are rejected.

- `GET /skill-update-check/status?sessionId=…&refresh=1` — check.
- `POST /skill-update-check/update` — update, with the body
  `{ sessionId, skills? }`.

The browser can send only a session id, `refresh=1`, and skill names, never a
path; the Host derives the directory from its own session and workspace
records. The update route accepts JSON POST only, bounds both name length and
name count, and intersects the names with a forced check, so the route cannot be
used to update arbitrary entries. The check is read-only; an update runs the CLI
with the workspace as cwd and only changes that workspace's lock and skill
directories. CLI output tails in responses exist for troubleshooting only.
