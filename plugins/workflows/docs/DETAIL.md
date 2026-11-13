# Buka Workflows

Persistent workflows with a job board. A workflow is a **position graph**; a job is one workflow version plus one input, and every job gets a board; a **task** is the smallest work unit, added by running positions at any time and dispatched only along drawn edges.

## Model

- **Workflow**: a persistent definition with versions; an orchestrator preset saves it with `buka_workflow_save`, and it is usable immediately. The page reviews it and can disable / re-enable it.
- **Position**: a graph node (besides the built-in start / end). One position has one executor: a person or a worker (agent / robot).
- **Task type**: the contract a position declares: payload schema, output schema, required upstream task types, the assistant for human tasks, and an optional plan mode.
- **Edge**: an allowed dispatch relation, optionally limited to task types; back edges are explicit. An edge is a permission, not a pipe.
- **Start / end**: built-in nodes executed by the starter. The start task turns the raw input into the first structured input; the end task carries the final deliverable and completes on delivery to the starter.
- **Job**: one workflow plus one input, pinned to a workflow version; numbering is per workflow. There are no cross-workflow jobs.
- **Task**: a card on the board with seven states: pending / ready / running / completed / failed / blocked / cancelled. Dependencies are explicit and the task graph is acyclic; each rework creates a new task record.
- **Board**: rows are positions (including start / end), columns are queue / ready / running / done / exception.

## Usage

1. Start a session with the "workflow orchestrator" preset, draft the position graph, and save it as a workflow version.
2. Review the graph and contracts in the sidebar "Workflows" page. Disable the workflow when you no longer need it, and re-enable it later.
3. Create a job:
   - page: fill raw input and structured input; the starter is the person;
   - session: run `/job`; the starter is that session, and the start task runs back in it.
4. On the job board, worker positions auto-claim ready tasks; human tasks are handled by the named assistant or by the person. Executors dispatch downstream tasks along edges; the end task returns the deliverable to the starter and the job settles.

## Tools

| Tool / command                             | Purpose                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `/job`                                     | Ordinary sessions: list usable workflows or start a job (starter = current session)   |
| `buka_workflow_save`                       | Orchestrator preset root session: validate and save a new, immediately usable version |
| `buka_workflow_list` / `buka_workflow_get` | Read the workflow catalog / full definition                                           |
| `buka_job_start`                           | Backend for `/job` and the page: create a job                                         |
| `buka_job_status` / `buka_job_cancel`      | Read or cancel a job                                                                  |
| `buka_task_create`                         | Running tasks: add downstream tasks at any time, more than once                       |
| `buka_task_complete`                       | Running tasks / assistant: submit structured result, text and attachments             |
| `buka_job_board` / `buka_task_get`         | Running tasks / assistant: read the board, a task and dependency results              |
| `buka_job_attachments`                     | Running tasks / assistant: search / read attachments within the visible set           |

Workflow-editing tools are visible only to root sessions of the presets named by `orchestratorPresets`, plus sessions started inside a directory listed in `orchestratorWorkspaces`; execution tools are visible only to task sessions, assistant sessions and starter sessions. Human tasks have no model answer tool.

## Human tasks and assistants

- A human task is an ordinary task from a human position. There is no "waiting for human" state; every task lives on the board.
- A human task type names an `assistant` (an agent) or `null`:
  - named assistant: when the task is ready the engine starts that assistant's session; the assistant uses its own skills to talk to the person and submits the result. Only the named assistant may claim the task.
  - `null`: the task waits in ready; the person claims it and fills the output form on the board.
- If the assistant fails the task returns to ready; no automatic switch, and the person can always finish it.

## Attachments

Each job has one attachment store. Every attachment records its source task / position, creator, size, mime, sha256 and description; visibility follows the data flow: the producing task, tasks that transitively depend on it, the starter and the job page. Unrelated branches cannot list, search or read it. Files live in the plugin job directory; metadata lives in `ctx.storageDomain`.

## Pages

Sidebar "Workflows" has one path: **workflow list → workflow → job**.

- **Workflow list**: name, version and job count. Disabled workflows stay in the list, greyed out and sorted last.
- **Workflow page** has two tabs:
  - **Jobs** (default): filter by all / running / completed / problems; cards show the request summary, task progress and claimable count.
  - **Definition**: an interactive top-down layered graph. Select a position for its executor and task types, start / end for their contracts, or a connection for its allowed task types. The drawer header carries the node identity, contract fields render as compact chips, and the structural summary and budgets sit at the top, with full contracts folded away.
- **Job page** has four tabs:
  - **Overview** (default): request / structured input, final deliverable, starter and error.
  - **Live flow**: the same definition graph with task state on top — who is doing what, done / total, claimable and failed; select a node for its tasks.
  - **Board**: rows are positions, columns are queued / claimable / running / completed / problems; narrow screens fall back to a status-grouped list.
  - **Assets**: the asset pool grouped by source task; the final deliverable is also shown on Overview.
- **Task drawer**: the result and available actions come first, followed by input, dependencies and attachments; actions follow `allowedActions` (claim / complete / retry / cancel). Human tasks use the output schema as a form; attempts, type and timestamps fold into "Details"; a failed end delivery offers "Retry delivery".

## Dependencies and storage

- Requires `@buka/dsh-plugin-workers` for worker registration and task sessions, and `ctx.storageDomain` (shipped by the base composition).
- Workflows / jobs / tasks / attempts / attachment metadata live in the `buka_workflow` domain; large texts and attachment files live under `~/.cache/dsh-plugin-workflows/jobs/<jobId>/`.
- The first v4 start deletes the old `runs/` and `settings.json` (hard cut); after that, jobs and tasks are never purged by a format version.

## Configuration

See `src/options.ts` for the data directory, orchestrator presets, orchestrator workspaces, worker preset, concurrency and budgets. `orchestratorPresets` defaults to the shipped `workflow-orchestrator`; `orchestratorWorkspaces` defaults to empty and, when set, lets sessions started in those directories (including subdirectories) save and read definitions without switching presets.

## Structure

- `src/domain/**`: types, state machines, ids.
- `src/store/**`: storageDomain tables, per-job queue, job directories.
- `src/definition/**`: workflow v4 validation and payload templates.
- `src/engine/**`: scheduling, executors, settlement, recovery.
- `src/tools/**`, `src/commands/**`: model tools and the `/job` command.
- `src/routes/**`: page read / action routes.
- `src/client/**`: sidebar page.
- `lib/index.js`, `lib/client.js`: build output, committed, never edited by hand.

## Tests

`test/workflows-core.test.mjs` (domain / store / definition), `test/workflows-server.test.mjs` (engine / recovery / attachments / tools), `test/workflows-client.test.mjs` (render smoke). Run `node --test`.
