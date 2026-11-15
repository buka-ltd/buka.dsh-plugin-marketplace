# Buka Workflows

Persistent workflows with a job board. A workflow is a **position graph**; a job is one workflow version plus one input, and every job gets a board; a **task** is the smallest work unit, added by running tasks at any time and dispatched only along drawn channels.

## Model

- **Workflow**: a persistent definition with versions; an orchestrator preset saves it with `buka_workflow_save`, and it is usable immediately. The page reviews it and can disable / re-enable it. Only the current definition version (v7) is valid; older workflows are tagged "needs upgrade" and cannot start jobs.
- **Position**: a graph node (besides the built-in start / end) that shows the shape of the flow. One position has one executor — a person or a worker (agent / robot). A position only carries a name and an optional note; it contributes no text to the execution prompt.
- **Task type**: the contract a position declares:
  - **definition**: preset information written by the orchestrator — what this kind of task is, what to do, facts about external systems (for example each service's pipeline); the executor reads it;
  - **content schema**: the format of the task content a creator must supply;
  - for human positions: **actions**, an optional assistant, and an optional plan mode.
- **Task content**: the concrete thing a creator writes for one task, as a string or an object; the engine validates it against the task type content schema, so a bad creator is rejected at creation time instead of failing the executor.
- **Action**: a button on a human task type — a name, an optional form (input schema), and a set of creations (which channel, which task type, which content template). A click-only action has no form; one action may create several tasks, or none.
- **Result**: a summary text plus attachments. Results never drive the flow; they exist for whoever manages the job. A task's value is the follow-up tasks it creates.
- **Channel**: a named dispatch route with an `id` and a human `label`, from one node to another, optionally limited to task types; back channels are explicit. Several channels may connect the same pair and their type whitelists may overlap; a task records the channel it took. A channel is a permission, not a pipe: the engine never reads the label.
- **Start / end**: built-in nodes executed by the starter. The start node `content` is the job input the starter fills in, and its `next` list creates the initial tasks; the end node `content` is the final report, and the job only settles after the starter confirms receipt.
- **Delivery rule**: chosen when the job is created — back to the starter (a session starter gets it delivered into that conversation, a human starter gets it as a board task), or to an assistant acting as a secretary.
- **Job**: one workflow plus one input, pinned to a workflow version; numbering is per workflow. There are no cross-workflow jobs.
- **Task**: a card on the board with seven states: pending / ready / running / completed / failed / blocked / cancelled. Every task except the start task records its inbound channel. Dependencies are explicit and the task graph is acyclic; each rework creates a new task record.
- **Board**: rows are positions (including start / end), columns are queue / ready / running / done / exception.

## Usage

1. Start a session with the "workflow orchestrator" preset, draft the position graph, and save it as a workflow version.
2. Review the graph and contracts in the sidebar "Workflows" page. Disable the workflow when you no longer need it, and re-enable it later.
3. Create a job:
   - page: fill the job input (the start node content schema) and choose whether the final report comes back to you or to an assistant; the starter is the person;
   - session: use `buka_job_start` or `/job` with the job input; the starter is that session.
4. On the job board, worker positions auto-claim ready tasks; human tasks are handled by the named assistant or by the person, who picks an action. Executors create follow-up tasks along channels; the end task goes back to the starter, and confirming it settles the job.

## Tools

| Tool / command                             | Purpose                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `/job`                                     | Ordinary sessions: list usable workflows or start a job (starter = current session)           |
| `buka_workflow_save`                       | Orchestrator preset root session: validate and save a new, immediately usable version         |
| `buka_workflow_list` / `buka_workflow_get` | Read the workflow catalog / full definition                                                   |
| `buka_job_start`                           | Start a job from a session: job input plus delivery rule                                      |
| `buka_job_status` / `buka_job_cancel`      | Read or cancel a job                                                                          |
| `buka_task_targets`                        | Running tasks: list the targets it can create next, with each content schema                  |
| `buka_task_create`                         | Running tasks: add a downstream task by target, any number of times; the engine routes it     |
| `buka_task_actions`                        | Running tasks: list the actions of a human task and their form schemas                        |
| `buka_task_complete`                       | Running tasks / assistant: submit result text and attachments; human tasks may pick an action |
| `buka_job_board` / `buka_task_get`         | Running tasks / assistant: read the board, a task and its dependencies                        |
| `buka_job_attachments`                     | Running tasks / assistant: search / read attachments within the visible set                   |

Workflow-editing tools are visible only to root sessions of the presets named by `orchestratorPresets`, plus sessions started inside a directory listed in `orchestratorWorkspaces`; execution tools are visible only to task sessions, assistant sessions and starter sessions. Human tasks have no model answer tool.

## Execution prompt

An executor (agent task or assistant) sees exactly three sections, in this order:

1. **Workflow rules**: engine-injected capabilities — read / write assets, create follow-up tasks with `buka_task_targets` / `buka_task_create`, submit with `buka_task_complete`;
2. **Task type definition**: the task type `definition`, where the preset facts live;
3. **Task content**: what the creator wrote for this task (a string as-is, an object as JSON).

Position labels, channel ids, job numbers, dependency lists and attachment lists never enter the prompt: they belong to the page and orchestration layers, so the executor is not exposed to the position / channel vocabulary of workflow authoring. Templates are only evaluated in definition-declared creations (human actions and the start node `next`) and may use `{{content.<path>}}` (the content of the task being completed) and `{{input.<path>}}` (the action form).

## Human tasks and assistants

- A human task is an ordinary task from a human position. There is no "waiting for human" state; every task lives on the board.
- A human task type names an `assistant` (an agent) or `null`:
  - named assistant: when the task is ready the engine starts that assistant's session; the assistant gets the whole task card (content, actions and their forms), talks to the person, and applies the action on their behalf.
  - `null`: the task waits in ready; the person claims it, picks an action (filling its form when it has one) and submits — or submits a bare result without creating anything.
- If the assistant fails the task returns to ready; no automatic switch, and the person can always finish it.

## Ending a job

- The previous task creates the end task along a channel; its `content` is the final report, validated against the end node content schema.
- The delivery rule is chosen at job creation:
  - **back to the starter**: a session starter receives the report in that conversation and confirms with `buka_task_complete`; a human starter gets the end task on their own board and clicks "received".
  - **to an assistant**: the end task is assigned to that assistant, who receives and confirms it.
- The job becomes completed only after the starter confirms; a failed delivery can be retried.

## Attachments

Each job has one attachment store. Every attachment records its source task / position, creator, size, mime, sha256 and description; visibility follows the data flow: the producing task, tasks that transitively depend on it, the starter and the job page. Unrelated branches cannot list, search or read it. Files live in the plugin job directory; metadata lives in `ctx.storageDomain`.

## Pages

Sidebar "Workflows" has one path: **workflow list → workflow → job**.

- **Workflow list**: name, version and job count. Disabled workflows stay in the list, greyed out and sorted last; workflows on an old definition version carry a "needs upgrade" tag.
- **Workflow page** has two tabs:
  - **Jobs** (default): filter by all / running / completed / problems; cards show the input summary, task progress and claimable count; jobs pinned to an old definition version carry an "old version" tag and cannot be opened.
  - **Structure**: an interactive top-down layered graph. Select a position for its executor, note and task types, start / end for their content contracts, or a channel for its sender, receiver and allowed task types. The drawer header carries the node identity, contract fields render as compact chips, and the structural summary and budgets sit at the top, with full contracts folded away; the legend stays pinned to the bottom of the canvas.
- **Job page** has four tabs:
  - **Overview** (default): job input, final report, starter and error.
  - **Live flow**: the same definition graph with task state on top — who is doing what, done / total, claimable and failed; select a node for its tasks.
  - **Board**: rows are positions, columns are queued / claimable / running / completed / problems; narrow screens fall back to a status-grouped list.
  - **Assets**: the asset pool grouped by source task; the final report is also shown on Overview.
- **Task drawer**: the result and available actions come first, followed by task content, dependencies and attachments. Human tasks start by picking an action and then fill that action's form; attempts, type and timestamps fold into "Details"; a failed end delivery offers "Retry delivery".

## Dependencies and storage

- Requires `@buka/dsh-plugin-workers` for worker registration and task sessions, and `ctx.storageDomain` (shipped by the base composition).
- Workflows / jobs / tasks / attempts / attachment metadata live in the `buka_workflow` domain; large texts and attachment files live under `~/.cache/dsh-plugin-workflows/jobs/<jobId>/`.
- **Version policy**: only the current definition version (v7) is valid and nothing is converted on open. Workflows on an old version stay in the list with a "needs upgrade" tag and cannot start jobs; upgrading means rewriting the definition in the current format from the orchestrator. Jobs pinned to an old version are read-only and cannot be opened.

## Configuration

See `src/options.ts` for the data directory, orchestrator presets, orchestrator workspaces, worker preset, concurrency and budgets. `orchestratorPresets` defaults to the shipped `workflow-orchestrator`; `orchestratorWorkspaces` defaults to empty and, when set, lets sessions started in those directories (including subdirectories) save and read definitions without switching presets.

## Structure

- `src/domain/**`: types, state machines, ids.
- `src/store/**`: storageDomain tables, per-job queue, job directories.
- `src/definition/**`: workflow v7 validation and task content templates.
- `src/engine/**`: scheduling, executors, settlement, recovery.
- `src/tools/**`, `src/commands/**`: model tools and the `/job` command.
- `src/routes/**`: page read / action routes.
- `src/client/**`: sidebar page.
- `lib/index.js`, `lib/client.js`: build output, committed, never edited by hand.

## Tests

`test/workflows-core.test.mjs` (domain / store / definition), `test/workflows-server.test.mjs` (engine / recovery / attachments / tools), `test/workflows-client.test.mjs` (render smoke). Run `node --test`.
