# Buka Workflows

Persistent workflows with a job board. A workflow is a **position graph**; a job is one workflow version plus one input, and every job gets a board; a **task** is the smallest work unit, added by running positions at any time and dispatched only along drawn edges.

## Model

- **Workflow**: a persistent definition with versions; an orchestrator preset saves it with `buka_workflow_save`, and the page reviews / activates / retires it.
- **Position**: a graph node (besides the built-in start / end). One position has one executor: a person or a robot (agent / program).
- **Task type**: the contract a position declares: payload schema, output schema, required upstream task types, the assistant for human tasks, and an optional plan mode.
- **Edge**: an allowed dispatch relation, optionally limited to task types; back edges are explicit. An edge is a permission, not a pipe.
- **Start / end**: built-in nodes executed by the starter. The start task turns the raw input into the first structured input; the end task carries the final deliverable and completes on delivery to the starter.
- **Job**: one workflow plus one input, pinned to a workflow version; numbering is per workflow. There are no cross-workflow jobs.
- **Task**: a card on the board with seven states: pending / ready / running / completed / failed / blocked / cancelled. Dependencies are explicit and the task graph is acyclic; each rework creates a new task record.
- **Board**: rows are positions (including start / end), columns are queue / ready / running / done / exception.

## Usage

1. Start a session with the "workflow orchestrator" preset, draft the position graph, and save it as a workflow version.
2. Review the graph and contracts in the sidebar "Workflows" page and activate the version.
3. Create a job:
   - page: fill raw input and structured input; the starter is the person;
   - session: run `/job`; the starter is that session, and the start task runs back in it.
4. On the job board, robot positions auto-claim ready tasks; human tasks are handled by the named assistant or by the person. Executors dispatch downstream tasks along edges; the end task returns the deliverable to the starter and the job settles.

## Tools

| Tool / command                             | Purpose                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `/job`                                     | Ordinary sessions: list active workflows or start a job (starter = current session) |
| `buka_workflow_save`                       | Orchestrator preset root session: validate and save a new workflow version (draft)  |
| `buka_workflow_list` / `buka_workflow_get` | Read the workflow catalog / full definition                                         |
| `buka_job_start`                           | Backend for `/job` and the page: create a job                                       |
| `buka_job_status` / `buka_job_cancel`      | Read or cancel a job                                                                |
| `buka_task_create`                         | Running tasks: add downstream tasks at any time, more than once                     |
| `buka_task_complete`                       | Running tasks / assistant: submit structured result, text and attachments           |
| `buka_job_board` / `buka_task_get`         | Running tasks / assistant: read the board, a task and dependency results            |
| `buka_job_attachments`                     | Running tasks / assistant: search / read attachments within the visible set         |

Workflow-editing tools are visible only to root sessions of the presets named by `orchestratorPresets`; execution tools are visible only to task sessions, assistant sessions and starter sessions. Human tasks have no model answer tool.

## Human tasks and assistants

- A human task is an ordinary task from a human position. There is no "waiting for human" state; every task lives on the board.
- A human task type names an `assistant` (an agent robot) or `null`:
  - named assistant: when the task is ready the engine starts that assistant's session; the assistant uses its own skills to talk to the person and submits the result. Only the named assistant may claim the task.
  - `null`: the task waits in ready; the person claims it and fills the output form on the board.
- If the assistant fails the task returns to ready; no automatic switch, and the person can always finish it.

## Attachments

Each job has one attachment store. Every attachment records its source task / position, creator, size, mime, sha256 and description; visibility follows the data flow: the producing task, tasks that transitively depend on it, the starter and the job page. Unrelated branches cannot list, search or read it. Files live in the plugin job directory; metadata lives in `ctx.storageDomain`.

## Pages

The sidebar "Workflows" page: workflow list -> workflow detail (graph, positions / task types / edges / start-end contracts / budgets, job list) -> job detail (board by default, plus graph, tasks, attachment store and timeline). The task drawer shows payload, dependencies, attempts, result and attachments, and offers the actions in `allowedActions`; human tasks render an output form; a failed end delivery offers "retry delivery".

## Dependencies and storage

- Requires `@buka/dsh-plugin-robots` for robot registration and task sessions, and `ctx.storageDomain` (shipped by the base composition).
- Workflows / jobs / tasks / attempts / attachment metadata live in the `buka_workflow` domain; large texts and attachment files live under `~/.cache/dsh-plugin-workflows/jobs/<jobId>/`.
- The first v4 start deletes the old `runs/` and `settings.json` (hard cut); after that, jobs and tasks are never purged by a format version.

## Configuration

See `src/options.ts` for the data directory, orchestrator presets, robot preset, concurrency and budgets. `orchestratorPresets` defaults to the shipped `workflow-orchestrator`.

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
