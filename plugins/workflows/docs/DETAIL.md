# Buka Workers & Workflows

Workers with a defined role, persistent workflows and a job board — the whole "put the company around the agent" pipeline in one plugin: skills give capabilities, workers carry responsibilities, workflows constrain structure, and the board dispatches tasks to positions, stopping for people at the checkpoints.

## Workers

Workers come in two kinds: **agents** (a directory, AGENTS.md, project skills, running as a DSH session; created, registered and mounted by the plugin) and **robots** (fixed programs that take an input and produce an output, with no session; v1 ships only the built-in `clock`, which is read-only). An assistant is not a flag on a worker: a workflow names an agent on a human task type or in the delivery rule, and the named agent handles that task or receives the final report on the person's behalf.

- Every worker has an immutable identifier (`id`) and an optional display name (`name`). The identifier is the reference key workflows use and the directory name (`workers/<id>`): chosen at creation and never changed. The name is display-only, can be changed at any time, need not be unique, and falls back to the id when empty.
- The page lists worker cards (avatar, name · id, driver, mount state, project skills, responsibility). Agents can start sessions, mount, rename (display name only), delete, install / remove project skills, browse the worker directory and code content in the read-only Files tab, pick a model for new sessions and change the avatar; robots are read-only.
- Deletion is a **hard delete**: registry entry, worker directory and workspace registration go together, with no archive state. The confirm dialog shows the impact first — **running jobs** that reference the identifier (the only blocker), workflows that would become unavailable, the finished-job count and the directory to delete — and states that AGENTS.md and project skills disappear with the directory; there is no force delete.
- The registry `workers.json` is version 4: each entry has an immutable `id`, an optional `name` and `driver: "agent" | "robot"`; robots also carry a `program` id, agents an optional `model`. New identifiers match `^[a-z][a-z0-9_-]{0,63}$`; older registry versions are migrated in memory, and legacy identifiers stay usable for update, rename and delete.
- A fresh install (empty registry) seeds two editable preset agents: `software-engineer` and `qa-engineer`.
- Project skills live under `<worker dir>/.agents/skills` and `.claude/skills`; AGENTS.md reads up to 256 KiB and saves up to 512 KiB; `CLAUDE.md` is kept as a relative symlink to it.

History: the plugin used to be `@buka/dsh-plugin-robots` (later renamed workers) and migrates the old cache and registry into `~/.cache/dsh-plugin-workers/` on startup. Since November 2026 workers and workflows ship as this single package (see "Upgrade and migration" below).

## Workflow model

- **Workflow**: a persistent definition with versions; an orchestrator preset saves it with `buka_workflow_save`, and it is usable immediately. The page reviews it and can disable / re-enable it. Only the current definition version (v8) is valid; v7 definitions are migrated to v8 when the store opens, and any other version is tagged "needs upgrade" and cannot start jobs.
- **Position**: a graph node (besides the built-in start / end) that shows the shape of the flow. One position has one executor — a person or a worker (agent / robot) referenced by the worker's immutable identifier. A position only carries a name and an optional note; it contributes no text to the execution prompt.
- **Task type**: the contract a position declares:
  - **definition**: preset information written by the orchestrator — what this kind of task is, what to do, facts about external systems (for example each service's pipeline); the executor reads it;
  - **content schema**: the format of the task content a creator must supply;
  - for human positions: **actions**, an optional assistant (named by worker identifier), and an optional plan mode;
  - a robot position's task types must also declare a `content` schema that covers the program's input contract (v1's clock reads an object with a required `until`): saving the workflow checks the declaration, and task creation plus execution re-check the actual content;
  - a robot position's **creates**: creation declarations the engine executes when the robot finishes a task; each created task depends on the finished task and its content template may only use `{{content.*}}`. This is how a clock wait hands off to real work.
- **Task content**: the concrete thing a creator writes for one task, as a string or an object; the engine validates it against the task type content schema, so a bad creator is rejected at creation time instead of failing the executor.
- **Action**: a button on a human task type — a name, an optional form (input schema), and a set of creations (which channel, which task type, which content template). A click-only action has no form; one action may create several tasks, or none.
- **Result**: a summary text plus attachments. Results never drive the flow; they exist for whoever manages the job. A task's value is the follow-up tasks it creates.
- **Channel**: a named dispatch route with an `id` and a human `label`, from one node to another, optionally limited to task types; back channels are explicit. Several channels may connect the same pair and their type whitelists may overlap; a task records the channel it took. A channel is a permission, not a pipe: the engine never reads the label.
- **Start / end**: built-in nodes executed by the starter. The start node `content` is the job input the starter fills in, and its `next` list creates the initial tasks; the end node `content` is the final report, and the job only settles after the starter confirms receipt.
- **Delivery rule**: chosen when the job is created — back to the starter (a session starter gets it delivered into that conversation, a human starter gets it as a board task), or to an assistant (an agent named by worker identifier) receiving it on the person's behalf.
- **Job**: one workflow plus one input, pinned to a workflow version; numbering is per workflow. There are no cross-workflow jobs.
- **Restart**: the two ways to continue a failed job — resume in place at the failure, or start over with a new job from the same input.
- **Task**: a card on the board with seven states: pending / ready / running / completed / failed / blocked / cancelled. Every task except the start task records its inbound channel. Dependencies are explicit and the task graph is acyclic; each rework creates a new task record.
- **Board**: rows are positions (including start / end), columns are queue / ready / running / done / exception.

## Usage

1. Start a session with the single **Workflow** preset, draft the position graph and save it as a workflow version; the same conversation can also create or update workers (it shows the draft and waits for approval).
2. Manage responsibilities and project skills on the **Worker** tab of the single sidebar entry; review graphs and contracts on the **Workflow** tab, disable a workflow when it is not needed and re-enable it later.
3. Create a job:
   - page: fill the job input (the start node content schema) and choose whether the final report comes back to you or to an assistant; the starter is the person;
   - session: use `buka_job_start` or `/job` with the job input; the starter is that session.
4. On the job board, worker positions auto-claim ready tasks; human tasks are handled by the named assistant or by the person, who picks an action. Executors create follow-up tasks along channels; the end task goes back to the starter, and confirming it settles the job.

## Tools

| Tool / command                             | Purpose                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `buka_workers`                             | List workers: id, display name, driver, mount state, responsibility, project skills, AGENTS.md                         |
| `buka_worker_build`                        | Workflow preset root session: create or update a worker from the approved id / name / avatar / description / AGENTS.md |
| `/job`                                     | Ordinary sessions: list usable workflows or start a job (starter = current session)                                    |
| `buka_workflow_save`                       | Workflow preset root session: validate and save a new, immediately usable version                                      |
| `buka_workflow_list` / `buka_workflow_get` | Read the workflow catalog / full definition                                                                            |
| `buka_job_start`                           | Start a job from a session: job input plus delivery rule                                                               |
| `buka_job_status` / `buka_job_cancel`      | Read or cancel a job                                                                                                   |
| `buka_task_targets`                        | Running tasks: list the targets it can create next, with each content schema                                           |
| `buka_task_create`                         | Running tasks: add a downstream task by target, any number of times; the engine routes it                              |
| `buka_task_actions`                        | Running tasks: list the actions of a human task and their form schemas                                                 |
| `buka_task_complete`                       | Running tasks / assistant: submit result text and attachments; human tasks may pick an action                          |
| `buka_job_board` / `buka_task_get`         | Running tasks / assistant: read the board, a task and its dependencies                                                 |
| `buka_job_attachments`                     | Running tasks / assistant: search / read attachments within the visible set                                            |

`buka_worker_build` is visible only to root sessions of the presets named by `builderPresets`; workflow-editing tools are visible only to root sessions of the presets named by `orchestratorPresets`, plus sessions started inside a directory listed in `orchestratorWorkspaces`. Both lists default to the shipped `workflow-orchestrator` (display name `Workflow`). Execution tools are visible only to task sessions, assistant sessions and starter sessions. Human tasks have no model answer tool.

## Execution prompt

An executor (agent task or assistant) sees exactly three sections, in this order:

1. **Workflow rules**: engine-injected capabilities — read / write assets, create follow-up tasks with `buka_task_targets` / `buka_task_create`, submit with `buka_task_complete`;
2. **Task type definition**: the task type `definition`, where the preset facts live;
3. **Task content**: what the creator wrote for this task (a string as-is, an object as JSON).

Position labels, channel ids, job numbers, dependency lists and attachment lists never enter the prompt: they belong to the page and orchestration layers, so the executor is not exposed to the position / channel vocabulary of workflow authoring. Templates are only evaluated in definition-declared creations (human actions and the start node `next`) and may use `{{content.<path>}}` (the content of the task being completed) and `{{input.<path>}}` (the action form).

## Human tasks and assistants

- A human task is an ordinary task from a human position. There is no "waiting for human" state; every task lives on the board.
- An assistant is a **name on the workflow**, not a flag on a worker: a human task type names an `assistant` (an agent identifier) or `null`, and the delivery rule can name one for the final report. Validation only requires the identifier to exist and be an agent; any registered agent can be named, whether or not it was ever "marked" as an assistant.
- A human task type names an `assistant` (an agent identifier) or `null`:
  - named assistant: when the task is ready the engine starts that assistant's session by identifier; the assistant gets the whole task card (content, actions and their forms), talks to the person, and applies the action on their behalf.
  - `null`: the task waits in ready; the person claims it, picks an action (filling its form when it has one) and submits — or submits a bare result without creating anything.
- If the named assistant does not hand back a result (its session ends without submitting, the task times out, or the session cannot be resumed), the task fails and the job immediately fails: the other open tasks are cancelled with a written reason, and the job error names the task, the assistant and the cause. There is no automatic switch and the person cannot take over.

## Restarting a failed job

A failed job is not a dead end: only a `failed` job shows the "Restart job" entry; `completed` and `cancelled` jobs have none. The dialog offers two options whose availability and reasons are decided by the server, and the client only renders them.

- **Resume from the failure**: the same job recovers in place, `failed → running`. The failed task goes back to `ready` and is dispatched again to the named executor with a new attempt record; tasks that job failure cancelled go back to `pending` and become ready through their dependencies; blocked tasks go back to `pending` once their dependencies are no longer failed, blocked or cancelled by a person. Tasks a person cancelled stay cancelled, and completed tasks keep their results and attempts. The job records the restart count and resets the duration budget start to the restart time.
- **Start over**: create a new job from the same input using the workflow version that is **enabled now**; the starter is the person who clicked restart, and the delivery rule follows the source job (back-to-starter becomes back to the new starter). The new job records the source job id; the failed job stays `failed` as the scene and remains readable. This option is unavailable when the workflow is disabled or not on the current definition version.
- A failed job with no failed task (for example every branch was cancelled, or end-task delivery failed) only offers "Start over".
- Restart is an explicit human action, not an automatic retry: if the assistant fails again the job fails again and can be restarted again. Resuming uses the definition version pinned by the job; only starting over picks up a changed workflow, and the two jobs keep separate budgets and boards.
- The state machine gained three transitions: job `failed → running`; task `blocked → pending` and engine-cancelled `cancelled → pending`. The task transitions are only used by the engine while restarting; a person cancellation writes no error at termination, so the restart tells them apart and never revives them.

## Unavailable (derived state)

Workflows and jobs can enter a derived "unavailable" state: a worker identifier they reference no longer exists in the registry. The state is never persisted; readers compute it from whether references resolve, and rebinding an existing worker clears it automatically.

- **Reference sources**: the executor of a position and the assistant of a task type in any workflow version; the pinned definition (position executors and task-type assistants) and the delivery assistant of a job. Legacy `name` values in v7 job snapshots are resolved as identifiers too.
- **Workflow**: the list and detail show which identifier is missing, and the workflow cannot start a job. Saving a new definition still validates that identifiers exist (reading an existing definition does not validate; it only marks it unavailable).
- **Job**: the job page marks it unavailable. A task whose executor is missing fails dispatch with an error that names the task, the position and the missing identifier; the task can be retried and other branches keep running. Human tasks whose named assistant is missing are no longer dispatched automatically and stay claimable, so a person can finish them.
- **Difference from "disabled"**: disabled is a deliberate pause and existing jobs keep running; unavailable means a reference broke and must be rebound. History shows a placeholder avatar and "Deleted" for positions, tasks and named assistants of deleted workers, keeping no tombstone records.

Deleting a worker is a hard delete (registry entry, directory and workspace registration together), blocked only by running jobs that reference the identifier. The delete dialog reads the impact through the plugin's read-only `ctx.bukaWorkflows.workerUsage(id)` service.

## Ending a job

- The previous task creates the end task along a channel; its `content` is the final report, validated against the end node content schema.
- The delivery rule is chosen at job creation:
  - **back to the starter**: a session starter receives the report in that conversation and confirms with `buka_task_complete`; a human starter gets the end task on their own board and clicks "received".
  - **to an assistant**: the end task is assigned to that assistant, who receives and confirms it.
- The job becomes completed only after the starter confirms; a failed delivery can be retried.

## Attachments

Each job has one attachment store. Every attachment records its source task / position, creator, size, mime, sha256 and description; visibility follows the data flow: the producing task, tasks that transitively depend on it, the starter and the job page. Unrelated branches cannot list, search or read it. Files live in the plugin job directory; metadata lives in `ctx.storageDomain`.

## Pages

The sidebar keeps one entry whose home page has two tabs at the top, **Workflow** first and **Worker** second. The tabs are hash-driven: `#/workers` (or `#/workers/…`) lands on the Worker tab, every other hash is a workflow route; refresh and back / forward keep the tab, and switching back to the Workflow tab restores the last workflow hash (for example a job page).

- **Workflow**: one path — **workflow list → workflow → job**:
  - **Workflow list**: name, version and job count. Disabled workflows stay in the list, greyed out and sorted last; workflows on an old definition version carry a "needs upgrade" tag.
  - **Workflow page**: **Jobs** (default, filterable; jobs pinned to a v7 snapshot carry an "old version" tag but stay readable and keep running) and **Structure** (an interactive layered graph; select a position for its executor and task types, start / end for their content contracts, a channel for its sender, receiver and allowed types).
  - **Job page**: **Overview** (input, final report, starter and error), **Live flow** (task state on the definition graph; a red dot marks a node whose session waits for your action or reply), **Board** (positions × states; narrow screens fall back to a status-grouped list) and **Assets** (the pool grouped by source task).
  - **Task drawer**: the result and available actions come first, followed by content, dependencies and attachments. Human tasks start by picking an action and filling its form; a failed end delivery offers "Retry delivery".
  - **Restarting a job**: a failed job shows the restart entry at the top of the job page, with each option disabled and explained when unavailable; a job created by "Start over" links back to its source job.
- **Worker**: the list view shows driver tags (agent / robot); a whole row opens the detail, whose tabs are "Settings" (responsibility and model), "Files" and "Skills". Robots (the built-in clock) are read-only. The delete dialog shows the impact before confirming (see "Workers").

The two tabs link to each other: "Open job" in the worker delete dialog just writes `#/job/...`; the home switches back to the Workflow tab and opens the job. Only the active tab is mounted: worker selection and drafts do not survive a tab switch, matching how switching between the two former sidebar panels behaved.

## Dependencies and storage

- Worker registration and task sessions ship in this plugin (the `ctx.bukaWorkers` service); workflow metadata needs `ctx.storageDomain` (shipped by the base composition).
- Worker data lives under `~/.cache/dsh-plugin-workers/` (`workers.json` registry plus `workers/<id>/` directories); workflows / jobs / tasks / attempts / attachment metadata live in the `buka_workflow` domain; large texts and attachment files live under `~/.cache/dsh-plugin-workflows/jobs/<jobId>/`.
- **Version policy**: the current definition version is v8. v7 workflow definitions are migrated to v8 when the store opens (the executor `name` field becomes `id`, the value is unchanged); the migration is idempotent. Workflows on any other version stay in the list with a "needs upgrade" tag and cannot start jobs; upgrading means rewriting the definition in the current format from the orchestrator. Job snapshots are not migrated: v7 jobs keep the old `name` fields and stay readable and resumable.

## Configuration

See `src/options.ts` (workflows) and `src/workers/index.ts` (workers): the workers root (`workersDir`), the build-tool preset list (`builderPresets`), the seed flag (`seedPresets`), the data directory, orchestrator presets, orchestrator workspaces, the worker session preset, concurrency and budgets. `builderPresets` and `orchestratorPresets` both default to the shipped `workflow-orchestrator` (display name `Workflow`); `orchestratorWorkspaces` defaults to empty and, when set, lets sessions started in those directories (including subdirectories) save and read definitions without switching presets.

## Upgrade and migration

This plugin merges `@buka/dsh-plugin-workers` and `@buka/dsh-plugin-workflows` (version 4.0.0):

1. **Uninstall the two old plugins first, then install this one.** Having both installed registers the same services, tools and patch rows (such as `preset-workflow-orchestrator`) twice, which conflicts.
2. **Zero data migration**: worker directories and registry, workflow definitions and job boards stay where they were and are read as-is.
3. **Presets merge**: the former "Worker builder" (`worker-builder`) and "Workflow orchestrator" (`workflow-orchestrator`) become the single **Workflow** preset (id kept as `workflow-orchestrator`), which both designs / saves workflows and creates / updates workers. Historical sessions of the old presets keep working.
4. Saved plugin configuration resets to defaults when the package changes; the defaults match the old ones, so only users who customized `workersDir` / `dataDir` / preset lists need to re-enter them in Settings.

## Structure

- `src/workers/**`: the workers half — registry, directories, AGENTS.md, project skills, model tools and `/buka-workers/*` routes.
- `src/domain/**`, `src/store/**`, `src/definition/**`, `src/engine/**`: workflow types, state machines, storage domain, definition validation and the scheduling engine.
- `src/tools/**`, `src/commands/**`: workflow model tools and the `/job` command.
- `src/routes/**`: workflow page routes.
- `src/client/**`: the workflows page; `src/client/workers/**`: the workers page; `src/client/home.ts` assembles the home page's two tabs.
- `src/index.ts`, `src/client/index.ts`: the two merged assembly entries (assembly only).
- `lib/index.js`, `lib/client.js`: build output, committed, never edited by hand.

## Tests

`test/workers-*.test.mjs` (workers: registry, build tool, routes, client smoke), `test/workflows-core.test.mjs` (domain / store / definition), `test/workflows-server.test.mjs` (engine / recovery / attachments / tools), `test/workflows-client.test.mjs` (render smoke), `test/preset-prompts.test.mjs` (preset persona rendering regression). Run `node --test`.
