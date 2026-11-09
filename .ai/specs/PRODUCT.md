# Product: Orchestrator-AI VS Code extension

Status: in progress

## Goal

Provide one generic Orquestrador agent in VS Code Chat that coordinates the
production lifecycle of software projects through first-party provider-session
adapters and task-scoped shared memory maintained by the Orchestrator.
The final product must support multiple compatible providers and multiple
independently configured accounts per provider, with user-authorized routing,
usage-aware limits, and task handoffs that preserve context. These are product
goals; provider support and authentication capabilities must be verified before
being presented as implemented.

## Recommended architecture direction — current migration path

Based on the user's latest steering, prefer the official AI Memory runtime as
the managed memory engine instead of independently recreating its wiki,
retrieval, lifecycle capture, and handoff semantics. The extension currently
downloads a pinned official Windows release into Orchestrator-owned VS Code
storage, verifies its published SHA-256, retains the MIT copyright and license
notice, and operates it through its supported HTTP/MCP interface in a private
data directory. This is managed installation, not binary vendoring inside the
VSIX. Before bundling binaries into a future VSIX, audit the complete
transitive-license set and add the corresponding source and notice delivery.
Do not read or reuse another provider's private credentials.

The user explicitly accepts incorporating AI Memory and complying with its
license. Its current official `main` LICENSE declares MIT and requires the
copyright and permission notices in copies or substantial portions. Source
incorporation is therefore a viable option, but this extension currently
manages the official verified runtime rather than embedding its Go source.
Before changing to source embedding, audit the exact upstream revision and all
transitive Go module licenses, retain the required notices, and verify that the
extension's release workflow includes the corresponding source/notice offer.
The current official Lich `main` LICENSE declares AGPL-3.0; do not incorporate
or translate Lich implementation code into this separately distributed VSIX.
Use Lich as a read-only design reference and implement the required behavior
independently. Recheck release-specific licenses before every distribution.
Sources: [AI Memory LICENSE](https://github.com/akitaonrails/ai-memory/blob/main/LICENSE),
[Lich LICENSE](https://github.com/lichdotdev/lich/blob/main/LICENSE).

Implement the Lich-like orchestration surface in Orchestrator-owned code using
public VS Code APIs and Git: provider-session adapters, scheduling, progress,
cancellation, worktrees, diff/review, resource view, and task handoffs. Do not
copy Lich source or assets. The current Lich repository declares AGPL-3.0-only,
while its README describes some older releases as MIT; the previously inspected
v0.85.0 license file conflicted with that README claim. Because the plan is to
reimplement behavior independently, this conflict is a source-reuse warning,
not an assumption that all feature-compatible code has the same license. Keep
the existing Lich adapter only as a migration bridge until first-party parity
gates pass.

This is the migration direction, not a claim that the target architecture is
already complete. The extension still has a Lich compatibility adapter and
does not yet provide full first-party provider-session parity. Implement
equivalent behavior through documented VS Code and provider APIs; when an
integration is private or unavailable, implement an independent Orchestrator
feature with supported interfaces rather than calling or imitating the private
API. Reassess package delivery, platform support, source version/hash, notices,
and dependency licensing before release.

### Lich source study — design reference, no source reuse

The user explicitly encourages read-only inspection of Lich's source code to
understand its design and identify good ways to implement equivalent behavior.
Inspecting source is part of the expected engineering process; do not avoid it
out of concern that merely reading it would be copying. Use observations to
derive requirements, lifecycle states, edge cases, and independent designs.
Implement those designs in Orchestrator's own modules and public VS Code or Git
interfaces. Do not copy or translate source fragments, assets, or private
protocol implementations. Keep a dated source-reference record and distinguish
observed behavior from Orchestrator design decisions. Recheck the exact source
revision and its license before any future source reuse or distribution.

The upstream source at revision `2650082c399420f2acb2c979873933ba2d9ddd70`
(2026-11-07) was reviewed read-only, including
[`internal/spawn/spawn.go`](https://github.com/lichdotdev/lich/blob/2650082c399420f2acb2c979873933ba2d9ddd70/internal/spawn/spawn.go),
[`internal/relay/relay.go`](https://github.com/lichdotdev/lich/blob/2650082c399420f2acb2c979873933ba2d9ddd70/internal/relay/relay.go),
[`internal/store/store.go`](https://github.com/lichdotdev/lich/blob/2650082c399420f2acb2c979873933ba2d9ddd70/internal/store/store.go),
[`internal/providers/providers.go`](https://github.com/lichdotdev/lich/blob/2650082c399420f2acb2c979873933ba2d9ddd70/internal/providers/providers.go),
and [`native/backend/session.go`](https://github.com/lichdotdev/lich/blob/2650082c399420f2acb2c979873933ba2d9ddd70/native/backend/session.go).
The source archive was unpacked in a temporary directory for inspection. No
Lich source, assets, or code fragments were copied into Orchestrator.

Design lessons to carry into the independent VS Code implementation:

- Treat task/session creation as an explicit lifecycle: resolve project and
  provider capabilities, reserve or create the checkout, persist the task and
  selected model/effort, publish visible state, then start the worker. If
  startup fails after persistence, retain a visible recoverable failed task.
- Keep durable task/session records separate from worker processes. Model
  running, parked, awaiting input, completed, and failed states explicitly;
  stopping a worker must preserve its checkout and continuation context.
- Make provider capabilities explicit (model, effort, resume, tool bridge,
  cancellation). Reject unsupported overrides and report unavailable
  telemetry instead of silently dropping options or inferring status from
  terminal text.
- Make delegation a bounded ticket lifecycle with distinct pending, answered,
  unread, undelivered, unanswered, stopped, and expired outcomes. Require an
  explicit completion response from the worker rather than scraping a TUI or
  treating successful process startup as task completion.
- Resolve a requested branch to an existing worktree before creating one;
  validate the base branch and checkout ownership, then surface changed files
  and review evidence against that task's checkout.
- Treat a handoff claim as a reservation, not proof that the new worker started.
  If dispatch fails before a recipient session exists, return the claim to a
  retryable pending state and retain the task and checkout context. Distinguish
  this from a worker that started and was later stopped or completed.
- Do not infer that a delegated agent received or completed work from a
  successful process launch. Preserve explicit delivery and answer states;
  bounded waits must leave a stable task/ticket identity that can be polled
  later, while unread, undelivered, stopped, expired, and answered remain
  distinguishable outcomes.

These are behavior and architecture observations from upstream source. The
Orchestrator must express them with its own TypeScript/JavaScript modules,
VS Code extension APIs, provider-supported interfaces, and Git; do not copy
Lich's implementation or its private RPC protocol. Where an official provider
interface cannot support a capability, implement the user-facing behavior at
the Orchestrator layer and state the provider-specific limit.

Follow-up read-only study (2026-11-07): rechecked the current Lich `main` at
`cbdfb833e20425c577dcc9470dc0686c07b2e743`, focusing on
[`internal/spawn/spawn.go`](https://github.com/lichdotdev/lich/blob/cbdfb833e20425c577dcc9470dc0686c07b2e743/internal/spawn/spawn.go),
[`internal/relay/relay.go`](https://github.com/lichdotdev/lich/blob/cbdfb833e20425c577dcc9470dc0686c07b2e743/internal/relay/relay.go),
and [`internal/store/store.go`](https://github.com/lichdotdev/lich/blob/cbdfb833e20425c577dcc9470dc0686c07b2e743/internal/store/store.go).
Observed behaviors relevant to Orchestrator: a created session is made
addressable immediately; session records and worker lifecycle are distinct;
relay distinguishes unread, unanswered, undelivered, stopped, pending, and
answered instead of parsing terminal output; and parked-session history is
bounded and indexed while live transcript remains provider-owned. Independent
design consequence: Orchestrator handoffs now record a recipient-bound
`session-started` receipt only after dispatch returns a session identity. This
is evidence of session creation and handoff association, not proof that the
provider agent read the prompt or completed the task. No Lich implementation,
asset, or private protocol was copied.

Implementation evidence (2026-11-07): task handoffs were claimed before the
recipient session was started. The dispatch failure path now releases only a
claim owned by that exact recipient back to `pending`, and records the release
in task history; a different recipient cannot release it. This makes a failed
handoff dispatch retryable without discarding its context. Unit coverage is in
`vscode-extension/test/taskJournal.test.js`. Runtime validation remains
separate and is not implied by this journal-level check.

Integration evidence (2026-11-07): using the pinned AI Memory v3.4.3 binary
already installed by the extension into the isolated development-host profile,
the full `npm test` suite passed 37/37 tests with both optional integrations
enabled. This exercised two extension-runtime instances sharing one private
AI Memory server, a scoped page write and verified read-back, plus the Codex
app-server task-attempt bridge in an isolated temporary `CODEX_HOME`. The
Codex test makes no model-generation request. The AI Memory test uses a
temporary storage root and removes it after the test. The separate VS Code
settings webview is accessible to inspect, but Windows denied UI input while
setting build fields; no build, VSIX creation, installation, or end-user runtime
claim is made from these integration tests.

Runtime log review (2026-11-07) found VS Code warning that the Orchestrator
webview had no recognized Content Security Policy. Both the settings panel and
Orchestrator home now share a nonce-based policy: resources are denied by
default, images/fonts are limited to the webview origin, and inline scripts
and styles require a unique per-view nonce. The previous `unsafe-inline`
style allowance was removed. `vscode-extension/test/webviewSecurity.test.js`
checks the policy shape and unique nonces; the full suite passes 38/38 with
both AI Memory and Codex integration tests enabled. A fresh extension-host log
after reload is still needed to prove the runtime warning has disappeared.

Validation blocker (2026-11-07): `.ai/orchestrator.json` still has `build: null`.
The installed `bin/code.cmd` targets `261c84cb1e/resources/app/out/cli.js`, but
that file is absent; a different installed tree contains the VS Code CLI, yet
invoking it with a separate `--user-data-dir` and
`--extensionDevelopmentPath` exited without creating the profile or logs.
Do not infer a fresh-host runtime result from the older host log until a new
separate window is actually observed and its extension-host log is inspected.

## Functional parity matrix — baseline before further implementation

Research date: 2026-11-07. The reference behavior below is based on the current
public `main` documentation for [Lich](https://github.com/lichdotdev/lich),
[AI Memory](https://github.com/akitaonrails/ai-memory), and the public
[VS Code Extension API](https://code.visualstudio.com/api/references/vscode-api).
The table defines the target and the evidence required; “partial” describes the
current Orchestrator code and is not a completion claim.

| Reference capability and observed behavior | Orchestrator behavior to implement | VS Code API or first-party mechanism | Equivalence evidence / current state |
|---|---|---|---|
| AI Memory durable project knowledge: wiki pages, source authority, pinned decisions, rules, and procedures survive sessions and are distinct from session transcripts. | Use the official managed AI Memory runtime and its supported project/page mechanisms for durable knowledge; keep Orchestrator task execution events and provider session records distinct, and link them by stable project/task IDs. Do not recreate AI Memory's wiki or page lifecycle in a parallel store. | Pinned official AI Memory release and supported MCP/API; project `.ai/specs/` and `.ai/skills/` remain user-owned requirements and procedures. | Create/read/update a durable decision with provenance through supported AI Memory tools, reopen the project and retrieve it, and preserve task history separately. **Current: managed AI Memory runtime and task/attempt pages exist. Settings provide project-scoped `memory_query`, create-only page creation with semantic/procedural tiers, pin, kind, and Git-verified source-file provenance, existing-page body edits through `memory_patch_page` with server-checked `expected_page_id` and section hash, and metadata edits through conditional `memory_write_page` with full body preservation and verified read-back. Runtime integration tests pass; manual Settings UI and cross-window recovery remain unverified.** |
| AI Memory retrieval: `memory_query` combines FTS, entity/graph/vector retrieval, reciprocal-rank fusion, authority ranking, and observation fallback; filters constrain retrieval before ranking. | Delegate retrieval to the official AI Memory runtime using its supported query/filter contract. The Orchestrator supplies exact workspace/project/task scope, presents bounded evidence and provenance, and reports no-result/error states without substituting its task journal for semantic memory. | AI Memory MCP/API; local task journal only for execution events, task identity, and resumable handoffs. | Query exact text and synonyms with project/path/tag/type filters, inspect ranking/provenance, and verify a true no-hit result against the official runtime. **Current: the official `memory_query` tool is queried automatically for VS Code Language Model and CLI coordinator requests with the resolved project scope and bounded results; Settings now discovers and displays only filters exposed by the active runtime, including path prefix, tag, semantic kind, tier, pinned-first ordering, superseded versions, score details, and result limit where supported. Unsupported selected filters fail closed. Runtime v3.4.4 integration verifies the filtered query, applied-filter report, and schema-derived result limits. Full-page follow-up UX, cross-window recovery, and retrieval evaluation remain incomplete.** |
| AI Memory lifecycle capture: hooks record prompts, visible responses, tool events/results, compaction checkpoints, and session summaries; private reasoning is excluded. | Capture events for Orchestrator-owned LM requests and tool calls, with explicit project/session/task IDs, redaction limits, and exclusion of hidden reasoning/secrets. Import other providers only through documented public APIs. | `ChatRequest`, `LanguageModelChat.sendRequest` response stream and tool-call parts, `lm.registerTool`/`invokeTool`, cancellation tokens. VS Code exposes no general API to read other extensions' private chat transcripts or hooks. | Run a task, inspect persisted event chain and redactions, restart, and verify exact visible prompt/tool/result reconstruction. **Current: Orchestrator-owned model and Codex adapter summaries are bounded and exclude hidden reasoning. It does not install external Codex lifecycle hooks: these are not required for task-scoped AI Memory reads/writes and require explicit Codex trust review. Automatic capture of direct Codex sessions outside Orchestrator is therefore not provided. Task-journal events, coordinator task pages, fallback attempt reports, and Codex/Claude MCP attempt-page writes now share redaction for common credential assignments (including quoted multiword values), known provider token formats, and PEM private-key blocks; a live AI Memory write/read-back verifies agent-page redaction. Direct capture from arbitrary provider extensions, broader secret-pattern coverage, and complete session summary/handoff behavior remain incomplete.** |
| AI Memory workstreams: exact `(workspace, project, repository, worktree)` scope, durable workstream identity, leases, native session links, portable event ledger, searchable history. | Keep stable project/repository/worktree identities and link task, attempt, provider profile, and session IDs; maintain event sequence and ownership/lease data across restarts and windows. | `workspace.workspaceFolders`, `workspace.fs`, `globalStorageUri`; Git CLI for repository/worktree fingerprinting; file locks/atomic journal writes. No built-in cross-extension workstream store. | Open same task in a second VS Code window and verify one writer, correct worktree separation, and recovery after owner shutdown. **Current: project-path journal and slot ledger include task/session/worktree paths; no canonical repository/worktree identity, portable session ledger, or cross-window runtime validation yet.** |
| AI Memory handoffs: typed ownership/recipient, list without consuming, claim exactly once, cancel/expire, and session-start delivery. Handoffs are not a live bus. | Implement task-scoped handoff records with compare-and-set claim, expiry/cancel, source/destination identity, and explicit delivery receipt. A new provider receives a bounded, untrusted continuity packet. | First-party journal with cross-window lock and atomic claim; coordinator JSON/tool response carries the bounded packet. No public VS Code handoff API. | Two concurrent claimers must yield exactly one recipient; cancel/expiry tests; cross-provider continuation verifies same task ID and records returned result. **Current: durable pending/list/claim-once/cancel records support manual transfer and coordinator-requested transfer from CLI and VS Code Language Model modes. The transfer claims the recipient before stopping the prior session and rolls the claim back if stop fails. Expiry is enforced at claim time; session-start receipts bind the recipient to the opened session. Startup recovery cancels a still-pending transfer, resumes a durably recorded recipient assignment after the old session was parked, blocks ambiguous claimed/opened states to prevent duplicate workers, and preserves results already committed as awaiting review or complete. Retrying clears the old handoff pointer while retaining its history. Unit tests cover these crash states; real cross-provider execution and recovery UI remain unverified.** |
| AI Memory compaction/recovery: checkpoints and post-compaction anchors recover original prompts and recent actions after context loss. | Maintain a bounded session anchor with original objective/constraints, recent visible events, latest checkpoint, and pointers to full history; reconstruct after extension-host restart. | VS Code chat `ChatResult.metadata` / `ChatResponseTurn.result` can preserve participant turn metadata where applicable; first-party persistent event store is still required. | Force a long multi-turn session/restart and verify objective, constraints, and latest confirmed state are available without replaying tool actions. **Current: partial.** The extension persists an anchor in workspace state with the original user objective (up to 6,000 characters), latest user prompt and coordinator response (up to 3,000 each), bounded task/session status, and up to 10,000 characters of recent visible history. The anchor is rehydrated and updated on view refresh and is marked as untrusted historical evidence in coordinator context. Tests cover objective preservation, bounds, task state, and absent old transcript messages. Full event history, checkpoint pointers, constraint extraction, privacy redaction, and separate-window restart/runtime validation remain outstanding.
| Lich provider sessions: launch native agents with provider/model/options; maintain stable session identity, process lifecycle, state, and return/delivery status. | Adapter contract for supported model/API or provider process: discover, readiness, launch, stream/progress, result, cancellation, continuation, failure, and profile identity. Never infer a provider session from installed extension name alone. | `vscode.lm.selectChatModels`, `LanguageModelChat.sendRequest`, capability discovery, request cancellation; the documented Codex app-server stdio protocol; Anthropic Claude Code CLI `stream-json`, resume, model/effort flags, and MCP permission-prompt tool; `window.createTerminal`/`tasks.executeTask` for supported CLI. Public APIs vary per provider. | Per supported adapter, run a real request, confirm model and session identity, capture progress/result, cancel, and recover failure. **Current: first-party VS Code model worker, Codex app-server adapter, and Claude Code CLI adapter are implemented in source. Isolated smoke requests through both native CLI adapters returned the expected response with provider session IDs; authentication checks reported ready without exposing account identity. A real Codex smoke found a stale model inherited from CLI config, which is now fixed by resolving the account-visible model and effort catalog before both worker and CLI-coordinator dispatch. The updated VSIX activates in a separate VS Code 1.145.2 profile and installs AI Memory v3.4.3. A real Claude coordinator plan was approved through the production scheduler; its real Claude worker then ran through the production task dispatcher in a first-party Git worktree, read the verified task page, wrote and read back its own AI Memory attempt page, made exactly one permission-approved source change, and reached the reviewed `complete` state while leaving the source checkout unchanged. Parallel scheduling, cross-window session recovery, cancellation under live load, rendered diff review, and a packaged VS Code runtime for this exact source revision remain unverified; Lich remains only as a compatibility executor for other CLIs.** |
| Lich side-by-side agents: multiple sessions simultaneously, each visible with status/context, logs/results, and independent worktree. | Schedule bounded independent task sessions with configurable parallelism; show identity, provider/model/profile, lifecycle, progress, error/result, and resource occupancy in the Orchestrator panel. | Webview/TreeView, status bar, `window.createTerminal`, task/session journal. `lm.sendRequest` requests can overlap subject to provider capability/quotas. | Start two independent tasks; observe both statuses/progress; verify exact task-to-session mapping and that cancellation affects only the selected task. **Current: the production scheduling path is covered with two independent tasks dispatched concurrently at `maxParallel=2`; the test confirms two live leases and that cancelling task A parks/releases only A while task B remains running with its lease. The card now exposes per-task cancellation for queued, starting, and running tasks. A starting task is marked for stop when dispatch returns; a running task releases its reservation only after stop is confirmed, and opening the freed slot re-runs the scheduler. Tests use deterministic adapter infrastructure, so real-provider cancellation under load and a separate VS Code runtime remain unverified.** |
| Lich task exchange: a session can delegate to another, route a handoff, receive an answer, and use tools/MCP/CLI beyond a one-shot result. | Provide coordinator-routed task/message tools, explicit task IDs and reply correlation, bounded inter-agent context, cycle/depth limits, and user-visible lineage. | `lm.registerTool`/`lm.invokeTool`, LM tool calls, custom chat UI, first-party task queue. VS Code cannot control arbitrary extensions’ internal agent sessions absent a public API. | Agent A requests a subtask, agent B receives it, returns structured result, A continues, and UI shows full message lineage. **Current: both the VS Code Language Model coordinator and CLI coordinator can request a bounded transfer of one existing task from the current chat. The VS Code path uses an internal tool; the CLI path returns a strict structured handoff object that the extension validates and executes. Both require current-user transfer intent or an observed blocked/failed task, constrain task/provider/executor/profile/model/effort to current state, verify Codex model/effort against the selected account catalog, claim the recipient before stopping the old worker, and release/cancel that claim if stopping fails. These are same-task handoffs, not arbitrary subtask/reply messaging or a live inter-agent bus. Claude/Lich do not expose model catalogs through this integration, and real provider handoff has not yet been validated in a separate VS Code runtime.** |
| Lich worktrees: separate branch/checkouts per task, optional `.worktreeinclude` ignored files, collision-free ports, current and isolated options. | Manage Git worktrees directly with collision checks, safe path containment, branch/base selection, optional explicit include allowlist, task-to-checkout identity, and preserve-on-stop. Port allocation/dev-server management only if requested and verified safe. | No built-in worktree API; execute Git via extension-host child process or `tasks.executeTask`; `workspace.fs` for approved file copy. | Dirty main checkout remains untouched; two tasks get distinct branches/paths; include rules copy only explicit files; failed launch preserves/reclaims checkout safely. **Current: first-party Git worktree creation, branch collision checks, identity-verified reuse, preservation, and `.worktreeinclude` selection of Git-ignored regular files are implemented in source; selected file copying, glob/exclusion behavior, and tracked-file preservation have focused tests; ports, safe automatic cleanup, and end-to-end VS Code runtime validation remain.** |
| Lich diff/review: live Git status/diff, inline agent output, user comments routed back to session. | Observe working tree changes continuously, show bounded diff and untracked files, attach line-specific review comments to the task, and deliver them to the owning or replacement session. | Source Control API, `TextDocument`/webview diff presentation, file-system watchers, adapter message/tool channel. | Modify tracked/untracked files, verify displayed status/diff, send a line comment and observe it arrive with the correct task. **Current: Git diff snapshots and review UI are rendered in the Orchestrator panel. On an awaiting-review task, the user can enter bounded corrective guidance; it is journaled and routed through the same task retry, preserving the task, worktree, provider, model, effort, and recorded session continuity where the adapter supports it. Line-specific review comments are implemented for added lines in a verified, non-truncated task diff; the UI collects the relative file/line and comment, journals it, and forwards it through the task retry. Focused tests cover path/line validation, retry delivery, and UI action presence. Live provider-stream steering and separate VS Code/provider runtime validation remain open.** |
| Lich collaboration surface: task/session wall, project contexts, terminal/browser/dev server integration and usage data where available. | Build a task/session dashboard first; add terminals, browser, servers, and usage only when each supported public API yields trustworthy lifecycle and usage evidence. | Webview/TreeView, Terminal API, Tasks API, built-in Simple Browser only through documented commands, provider usage endpoints only when official. | UI action opens/controls the exact resource and its state; usage label traces to a documented source. **Current: task board and approximate budget fields; no terminal session wall or verified usage API.** |
| VS Code model discovery and consent: models are contributed by extensions and availability can change; first request may show consent and fail for quota/model removal. | Re-query dynamically, require declared capabilities, show provider/model readiness accurately, request access only on user action, and surface consent/quota/missing-model errors. | `lm.selectChatModels`, `lm.onDidChangeChatModels`, `LanguageModelChat.capabilities`, `lm.accessInformation.canSendRequest`, `sendRequest`, cancellation. | Add/remove a model provider, deny consent, exhaust/block quota, and confirm UI reflects actual availability/error without claiming authentication reuse. **Current: the coordinator re-queries contributed models when VS Code reports model-list or access changes, reads the official `canSendRequest` state without prompting, and displays authorized, consent-required, blocked, or unknown access. A blocked model cannot be selected for a coordinator request; first consent is requested only after the user sends a message. The settings view summarizes per-model access state. Unit coverage verifies all access outcomes; interactive consent, denied access, quota errors, and live model add/remove behavior still need validation in a VS Code window.** |
| VS Code authentication: authentication providers expose accounts/sessions with user consent; access is extension-specific. Built-in GitHub/Microsoft are not a generic bridge to Claude/Codex credentials. | Use `authentication.getAccounts/getSession` only for a provider that publicly registers a compatible API; otherwise use the provider’s official CLI login or state that the VS Code session is unavailable. Separate account profiles only when supported. Never read credential stores. | `vscode.authentication`, `AuthenticationProviderInformation`, `SecretStorage` only for Orchestrator-owned secrets; model API access follows its consent flow. | Verify provider ID, account identity, explicit access, successful provider request, and account isolation. **Current: VS Code model access is unverified until request; CLI profile support is limited to direct Claude/Codex.** |
| Licenses/source reuse: Lich's currently reviewed source is AGPL-3.0-only; AI Memory v3.4.4 is MIT. | Do not incorporate Lich source, assets, or private protocols. Use its code only as read-only behavioral reference, then implement independently. Use the supported AI Memory runtime and include its required MIT notices; audit the final package and dependencies. | Public Git/VS Code/provider interfaces and the official AI Memory runtime; repository license and notices. | Inspect the exact source/tag license and produce a dependency/SBOM/license report for the packaged artifact. **Current: no Lich source, assets, or binaries are in the VSIX. Version 0.1.84 contains a CycloneDX 1.5 SBOM for seven production npm packages plus the externally installed AI Memory v3.4.4 runtime with its pinned SHA-256; all seven npm license files and the AI Memory MIT notice are included. Archive inventory: 108 entries; SHA-256 `60B329A8749537BF7090245D465A9C039DBB241527BB39BA92C2D62452CC9022`. The isolated VS Code 1.145.2 window activated the extension and reported the managed AI Memory runtime ready; the test window and its process tree were closed.** |

When a public VS Code or provider API does not expose a needed operation, the
Orchestrator must implement that operation in its own runtime for sessions and
data it owns (for example, session lifecycle, task messaging, memory capture,
retrieval, handoff claims, and Git worktrees). It must not attempt to control an
external extension's private chat/session state or credentials. The user can
still choose the same provider through its public VS Code model API or launch
it through its official CLI integration; the resulting Orchestrator-owned
session is independently tracked.

The matrix is a requirement and verification plan, not a parity declaration.
Rows move to “verified” only after the stated behavior is exercised in a
separate VS Code test window and its evidence is recorded below.

## Project layout

When initialized, any target project receives `.ai/specs/` for project-local
requirements and decisions, and `.ai/skills/` for reusable task procedures.
Initialization is additive and must never replace user files. The extension
ships generic skills and installs them into each project.

Project-level settings are edited in a **Configurações** dialog opened from the gear in the VS Code Chat view title. It exposes the build executable, arguments, working
directory, timeout, upstream repositories, and optional tool executable
overrides. It discovers configured agent CLI providers and language-model
providers published to VS Code, instead of showing every task-specific custom
agent profile. Users choose the orchestrator's provider and model separately
from the default Lich worker provider, model, and effort. The coordinator can
use a model exposed through VS Code's Language Model API or a separately
configured Claude/Codex CLI profile. CLI coordinator profiles use only the
provider's official authentication flow and documented status command; the
extension does not read credentials from another extension. Claude can use a
separate CLI config directory whose path is checked against the CLI status
response. Separate Codex identities use an isolated `CODEX_HOME` and the
documented `cli_auth_credentials_store = "file"` setting so the CLI stores
credentials in that profile's CLI-managed `auth.json`, away from a shared
system keyring. The Orchestrator never reads that file; Codex file storage is
not encrypted by the extension. The VS Code Language Model API has
no generic effort field; CLI model and effort settings are passed only on the
CLI path. Per-task delegations can override worker provider, model, and effort.
The JSON file is internal storage, not the user-facing settings workflow.

The view includes **Preparar projeto (.ai)**. It is available only when the
workspace has no `.ai` path. If `.ai` exists, initialization makes no changes.

## Multi-provider profiles and usage-aware orchestration goal

This is a final-product objective, not a claim about current capability. The
Orchestrator must not impose a one-account-per-provider limit, even if an
individual VS Code interface does. It should let users add, name, edit,
authorize, disable, and remove distinct profiles without changing another
profile or the general VS Code/provider installation. A profile represents a
separately configured identity and records its provider, supported
authentication method, readiness, availability, and usage information only
when the integration can verify that information.

Profiles may include multiple Codex/ChatGPT accounts, multiple Claude accounts,
Gemini, Copilot Pro, and other agents actually exposed through supported VS
Code or Lich interfaces. The user may choose a profile for a task or authorize
the coordinator to select among allowed profiles by configured rules. Multiple
instances of one provider may run concurrently under different profiles only
when the official CLI/API supports isolated identities and the configured
per-profile concurrency limit permits it. Never extract another extension's
credentials or assume VS Code, web, and CLI logins are interchangeable. If a
session cannot be shared through a public interface, offer that provider's
official authentication flow. Store secrets only in an appropriate secure
credential store; never write them to project files, AI Memory, or logs.

The coordinator should select an authorized profile per task, either by the
user or by configurable routing rules. Rules may consider task/provider
compatibility, profile readiness, per-profile parallelism, known usage limits,
user preferences for cost/quality/speed/privacy, and relevant failure history.
The user may pin a profile to a task or let the coordinator choose only among
profiles explicitly authorized for it. Parallel work and retries must respect
configured per-profile limits. Usage, token, and cost figures may be shown only
when supplied by a reliable source, with estimates labeled as estimates and
unavailable data identified plainly. The interface must distinguish verified
authentication, missing authentication, and authentication that cannot be
shared with the Orchestrator.

Profile failover is allowed only to another profile explicitly authorized by
the user and only when doing so complies with that provider's policies and
terms. Do not rotate accounts to evade quotas, rate limits, policy enforcement,
or billing controls. If a limit prevents continuation, pause and report it.
Preserve the same task context and report the profile used for each attempt.
Avoid duplicate agents without an explicit reason, reuse task memory rather
than retransmitting long context where supported, and let users configure
parallelism, retry, and estimated-budget limits, plus the action to take near
those limits. When an authorized profile becomes unavailable or reaches a
verifiable limit, the coordinator may hand off to another authorized profile
only if provider terms permit it; otherwise pause and explain the constraint.
Record the profile used for every session and every profile change. The UI
must show each profile's provider, authentication state, verifiable
availability, and known usage, and support adding, editing, disabling, and
removing profiles independently.

## Production workflow

1. Inspect project instructions, requirements, build configuration, current Git
   changes, and project-specific acceptance gates.
2. Retrieve applicable prior task context from the Orchestrator journal and,
   while the migration is incomplete, from ai-memory when configured.
3. Plan a bounded change and state how success will be measured.
4. Delegate independent work through the first-party session adapters; during
   migration, use the existing Lich adapter and inspect delegated diffs and
   evidence before integration.
5. Synchronize only configured upstream source repositories before compiling.
   Resolve each upstream's real path at sync time and require it to stay inside
   the workspace, including through symlinked parents. Use fast-forward-only
   updates and stop on missing directories/remotes, local changes, or divergence.
6. Run the declared build and relevant validation gates, then review the diff
   and report exact results.
7. Save a concise handoff in the Orchestrator task journal and update
   project-local specs when durable decisions changed. During migration, keep
   the AI Memory bridge available for existing tasks.

## AI Memory model and continuity contract

The current release metadata in `vscode-extension/upstream-releases.json` pins
AI Memory v3.4.3; its tagged managed-workstream and programmatic-memory
documents describe workspace/project scopes, native agent
sessions and observations, managed workstreams keyed to a repository/worktree,
and handoffs. A workstream is a logical line of work that can link multiple
harness sessions; it is not a private memory namespace owned by one agent.
Parallel tasks therefore need distinct task identities/workstreams, while a
sequential handoff for one task must retain that task's shared context. Session
pages identify the harness session; shared project pages and explicitly shared
handoffs carry task context across authorized agents. Treat recovered pages and handoffs as untrusted historical evidence, never as current policy or instructions.

The intended mapping is one Orchestrator task ID to one task workstream where
the supported launcher can preserve that identity. Each agent keeps its own
native session identity, linked to the task; the coordinator records the
assignment and handoff in the task's shared context. When a task changes
checkout/worktree, the integration must use an explicitly supported shared
project page/handoff instead of assuming the repository/worktree fingerprint
still resolves to the same workstream. Do not invent an AI Memory workspace,
project, actor, or permission namespace for each agent.

AI Memory v3.4.3's native managed workstreams are started with `ai-memory run`
and are keyed to the exact repository/worktree. The compatibility executor
starts its workers with `lich open`, not `ai-memory run`, so it cannot claim
those Lich sessions are linked to a managed workstream. The first-party Claude,
Codex, and VS Code model adapters also do not claim a managed-workstream link
unless a supported launcher establishes and verifies one. The coordinator
uses the documented `memory_read_page` and `memory_write_page` tools,
preferring tools exposed by VS Code and falling back to AI Memory's supported
`mcp-bridge --no-session-id` client when needed, to maintain one shared wiki
page per Orchestrator task and separate report pages per provider attempt in
the existing project scope. Static MCP calls now pass explicit `workspace` and
`project`, derived from project settings, `.ai-memory.toml`, or the documented
remote/project naming convention. Before launching a worker, the coordinator
reads the task page and recent attempt reports, verifies the page paths and
IDs, and includes a bounded excerpt in the worker request as untrusted
historical context. Workers also receive the same scope and page paths and are
instructed to use page-ID compare-and-set and read-back verification. If an attempt report
is not readable after a worker result, the coordinator may create a clearly
attributed fallback summary with `create_only` and verify it by reading it
back; it never overwrites an existing page or claims the summary was written
by the agent. This is a supported shared-page bridge, not a private AI Memory
namespace or a native managed workstream. The UI reports context-read,
coordinator-write, and attempt-report verification separately; absent tools or
a successful read-back, memory remains explicitly unverified. End-to-end proof
that a replacement provider can access and continue the same task page is
still required before claiming cross-provider continuity is fully validated.

The pinned AI Memory v3.4.3
[`programmatic-memory.md`](https://github.com/akitaonrails/ai-memory/blob/v3.4.3/docs/programmatic-memory.md)
documents that scoped page writes and handoff creation may create a missing explicit project scope,
while reads fail closed on a missing scope; `memory_resolve_write_target` is
only a preflight for an existing scope and does not create or promote one.
Therefore first-use initialization must remain narrow: after the read-only
scope preflight reports that the derived project does not exist, the
coordinator may attempt exactly one `create_only` write for that task's
generated page, read that exact page back and verify its marker and page ID,
then resolve the stable project ID before normal updates. Any unsupported tool,
authorization error, name collision, or failed read-back leaves memory
unverified and must not trigger broad project bootstrap, history import, or a
claim that the project was initialized. This sequence follows the pinned
release's documented MCP behavior and is implemented in the task board; it
still requires a live runtime confirmation before parity is declared.

The prior installed v3.4.2 MCP `tools/list` audit confirmed that `memory_handoff_begin` is
for ending or wrapping the current agent session and that `shared: true`
publishes it to the next agent opening the entire project; `memory_handoff_accept`
is single-use. The Orchestrator's static `mcp-bridge --no-session-id` client
does not have a native agent-session identity, and several independent tasks
may be in flight. Do not use a project-wide single-use handoff as a per-task
transfer or risk delivering/consuming another task's context. For Orchestrator
transfers, continue to use the task-keyed shared page plus attempt report pages,
and include those exact paths in the receiving worker request. Native AI Memory
handoffs may be used only when an agent's real session-ending integration owns
the handoff and the resulting scope/recipient is verified.

AI Memory v3.4.3 also documents external lifecycle capture through
`POST /hook/batch`, with `AI_MEMORY_CAPTURE_OWNER` set in the harness process
before launch and the harness's real native session ID preserved. This could
record observed worker events without inventing a workstream or actor. Lich
v0.85.0's documented `open` command accepts no per-session environment
overrides and returns a Lich session ID rather than a documented provider
native session ID; enabling external capture from this extension would risk
duplicate events or misidentifying sessions. Keep the verified task-page bridge
until Lich exposes those lifecycle details through a supported interface.

The installed stable Lich v0.85.0 `open --help` exposes provider, model, effort,
worktree, prompt, and project selection, but no account/profile selector. The
README at the same v0.85.0 tag documents multiple Claude and Codex account
profiles in Lich's Providers UI and moving a session between accounts in its
card. The public CLI and `open_session` MCP schemas still have no per-task
profile field. The extension therefore cannot enumerate, select, or verify a
worker profile through its current supported Lich interface; a user can change
it through Lich's own UI, outside the Orchestrator's automatic routing.
AI Memory v3.4.3 documents named `run --profile` entries that apply environment
overrides to its own managed launcher; they do not select a profile for a
session created directly by `lich open`. The extension therefore cannot yet
route an individual Lich task to a distinct account without changing shared
provider configuration or bypassing Lich. Profile-aware task routing remains
unimplemented until Lich exposes a supported per-session identity interface or
an officially supported launcher bridge can preserve both Lich management and
AI Memory workstream identity.

The installed Lich v0.85.0 `control --help` describes `control` as driving a
running Claude Code session and labels it experimental; it is not a generic
coordinator reply API for Codex, Claude, Copilot, and other providers. Although
`open --prompt` and `wait` can deliver a one-shot CLI result, Lich does not
expose a read-only coordinator mode in the confirmed command interface. The
extension therefore invokes Claude/Codex CLI coordinators directly, outside
Lich, with read-only planning restrictions: Claude receives only Read, Glob,
and Grep, has MCP tools disabled, and runs in restricted plan mode; Codex uses
its read-only sandbox, no approvals, ignored user configuration, and structured
output. These coordinators create a plan or answer only; Lich starts workers
after plan approval. VS Code language models remain available through the
public Language Model API when providers expose them.

## Current dependency lifecycle (migration only)

- The default command installs the pinned AI Memory runtime into extension-owned VS Code storage, verifies the archive before extraction, and starts a private loopback service with an Orchestrator-owned data directory. A user-configured custom executable remains supported. Orchestrator uses the supported MCP bridge for task-scoped memory reads and writes. It does not install Codex lifecycle hooks or modify Codex settings: hooks are optional for Orchestrator task execution and would trigger Codex's separate trust review. Direct Codex-session lifecycle capture outside Orchestrator is not provided. Lich remains optional and is not installed or started by the current path.
- AI Memory lifecycle hooks remain an upstream capability, but Orchestrator does not install or package a hook installer. Hooks are not required for task-scoped memory reads and writes; direct provider sessions outside Orchestrator are not captured. The Codex app-server receives the scoped MCP bridge only in the Orchestrator-owned process.
- When packaging each new extension version, query each upstream GitHub
  repository's latest stable release and pin its exact tag, asset URL, and
  SHA-256 digest in `upstream-releases.json`.
- The package must fail if a stable release, expected asset, or digest is
  unavailable. Do not bundle upstream executable binaries in the VSIX.
- Initial automatic asset support is Windows x64. Do not claim other platforms
  until their assets, install paths, and validation are implemented.

Hook-removal package validation (2026-11-09): removed the unused Codex hook
installer and its hook-installation tests. The Codex AI Memory integration test
now checks only the task-scoped MCP bridge. The packaged 0.1.75 VSIX was built
after refreshing current stable upstream metadata (Lich v0.87.0 and AI Memory
v3.4.4), installed in the current user's extension directory, and activated
in a separate VS Code 1.145.2 profile. The installed package has no
`src/aiMemoryHooks.js`; the current user `.codex/hooks.json` contains an empty
hook map. The full suite passes 114 tests, with 4 optional integrations skipped.
The isolated test window presented VS Code's Copilot onboarding and did not
expose the Orchestrator tab for visual confirmation. The configured Claude CLI
is authenticated, but the selected coordinator profile is absent from that
test profile's extension state; a live coordinator reply and end-to-end task
handoff remain unverified.

Coordinator profile recovery (2026-11-09): when project settings select a CLI
profile ID that is absent from the current VS Code extension state, the next
chat request may offer to bind that same ID to the provider's current CLI login.
The extension verifies authentication through the official CLI and asks for
explicit confirmation before persisting the binding or sending the prompt. It
does not recover if another profile for that provider exists, preventing an
implicit account switch. Focused recovery and readiness tests pass 11/11; the
confirmation dialog and resulting live provider response still need validation
in a trusted VS Code window with the profile recovery path.

Live coordinator CLI smoke (2026-11-09): exercised the packaged source's
coordinator adapter with the already-authenticated local Claude and Codex CLIs.
Both reported verified authentication and returned a schema-conforming
`mode: answer` response to a short prompt that contained no project context and
prohibited file tools. Claude's request also passed through the configured-ID
recovery helper, with persistence limited to an in-memory test callback.
This confirms CLI authentication, structured response parsing, and the
recovery helper against real provider CLIs; the VS Code confirmation dialog,
webview-to-coordinator wiring, task dispatch, and handoff are not covered by
this smoke and remain pending.

## Dedicated Orchestrator runtime migration

The final product should not require separate Lich or AI Memory installations
or background services. The Orchestrator should own task planning, scheduling,
session tracking, handoffs, and task-scoped memory in its VS Code extension
runtime (or in a first-party helper shipped and versioned with the extension).
Provider CLIs and official authentication remain external provider interfaces;
the Orchestrator must not extract credentials from VS Code extensions or
pretend provider authentication can be embedded.

Study both source repositories and reuse compatible components when they
materially improve functional fidelity. Direct inspection found the Lich
v0.85.0 tag's `LICENSE` text is AGPL-3.0 even though its current README says
releases through v0.9.0 remain MIT; do not copy that tag's source until the
conflict is resolved. AI Memory v3.4.3 is MIT-licensed, but its memory engine is
a multi-crate Rust service; embedding selected store/query components may be
possible, but including the service unchanged would retain a substantial
runtime dependency. Preserve notices and reassess third-party licenses for
any source adopted.

Migration is incremental and must preserve the existing supported workflow at
each stage:

1. Replace AI Memory task pages with a first-party, project-scoped task journal
   that records objective, criteria, assignments, attempts, decisions, changed
   files, blockers, and next steps. Give the coordinator and authorized worker
   adapters read/write access to the same task record; distinguish verified
   writes from unverified provider claims. Keep project-wide semantic recall as
   a separate capability until an implementation and retrieval quality are
   demonstrated.
2. Define a first-party provider-session adapter contract for discovery,
   authenticated readiness, launch, progress/result capture, cancellation,
   continuation, model/effort selection, and profile identity. Implement only
   operations each provider's documented CLI/API supports. Preserve per-task
   account isolation and never bypass usage limits.
3. Replace Lich session/worktree operations with first-party adapters and Git
   worktree management. Persist session ownership and reconcile live processes
   before dispatch; fail closed when active work cannot be verified. Provide
   safe cancellation and handoff before removing the Lich dependency.
4. Remove binary downloads, installers, settings, commands, and release pins
   for Lich and AI Memory only after the replacement passes the same acceptance
   gates for dispatch, isolation, cancellation, retries, continuation, memory
   read/write verification, and extension-host recovery.

The migration is incomplete while any normal task workflow still invokes
`lich` or `ai-memory`, and packaging must not claim those dependencies have
been removed until clean-profile runtime validation proves otherwise. This
direction does not remove the need for provider CLIs, provider accounts, Git,
or provider-specific authorization.

The public VS Code Language Model API is a supported candidate for a first-
party worker adapter: it can select extension-published models, stream
responses, receive tool calls, and cancel requests. Only models whose published
capabilities confirm tool calling may run coding tasks through this adapter.
The extension must request model access in response to a user action, handle
consent, missing models, quota blocks, and cancellation, and persist enough
task context to recover when the extension host stops. The API has no generic
effort field, so do not claim an effort setting was applied through it; retain
provider-specific CLI adapters when the user selects a model/effort combination
that the model API cannot express. Provider extensions must expose their model
through the public API; installed extension names or private authentication
state alone are not proof of worker compatibility.

### Migration progress - local task journal and retrieval

The extension now has a first-party JSON task journal under its VS Code
global-storage directory, partitioned by normalized project path and guarded
with a cross-window file lock. It records task criteria, provider/model/effort,
attempt events, session and worktree identifiers, results/errors, handoff text,
changed files, and whether an optional AI Memory read was verified. Dispatch
requires a verified local journal write; AI Memory writes are now best-effort
and no longer block dispatch. Coordinator prompts and subsequent worker
attempts can read the journal as untrusted historical context. Journal records
are updated on approval, dispatch, polling, review, retry, pause, cancellation,
and handoff. The local search is project-scoped BM25-style lexical retrieval
with filters for run, task, provider, status, attempt, session, and changed-file
prefix. It is not yet AI Memory's entity/graph/vector/observation hybrid search,
nor a durable knowledge wiki with supersession, pinning, consolidation, and
temporal validity. Secret scrubbing is pattern-based and is not a guarantee
against arbitrary unknown secret formats. The extension still invokes Lich
and can invoke AI Memory, so dependency removal and runtime validation remain
incomplete.

The first-party model worker now reads prior attempts from this journal and
records its visible prompt, responses, tool calls, and bounded tool outcomes.
File contents and command output are omitted from tool-event summaries; common
credential formats and key/value secrets are redacted before journal writes.
This capture covers only tasks executed by the Orchestrator's own model worker,
not private sessions from other extensions or the coordinator's direct chat.
The journal also has typed task handoff records with recipient/model metadata,
bounded redacted continuity, non-consuming listing, cross-window atomic
claim-once, cancellation, and claim-time expiry. The task transfer UI creates
and claims a handoff for its selected recipient before scheduling continuation.
This is a task handoff queue, not a general real-time inter-agent message bus;
failed-recipient recovery and coordinator-authored background delegation remain
to be completed.

### Migration progress - first-party VS Code model worker

The extension now detects VS Code-published models whose declared tool-calling
capacity can support the Orchestrator's five project tools, and can execute an
approved task through those models. The first-party worker can list, search,
read, and write files within the approved checkout, run bounded commands with
an argument array, poll progress, and cancel the model request or active child
command. The task plan records the executor and exact model. By default, this
executor creates and records an isolated Git worktree for the task; users may
explicitly approve `worktree: "current"` when uncommitted checkout files are
required. Worktrees are preserved after completion or cancellation. The public
VS Code LM API still does not expose a generic effort parameter; plan approval
rejects incompatible requests. Its tasks use the first-party journal for approval, ownership,
progress, results, review, retry, cancellation, and handoff. Those task events
do not invoke AI Memory. When a run contains only VS Code model tasks, its
session inventory and scheduling also use the first-party journal and do not
query Lich. Tasks requiring provider-specific effort still use the existing
CLI/Lich path, and the coordinator's optional semantic
memory and existing management commands still integrate with AI Memory/Lich.

The model session itself currently lives in the owning extension host. If that
host exits during a request, the journal can report the interruption and
support a new attempt, but cannot resume the provider's in-flight request.
Clean-profile VS Code runtime execution, consent, cancellation, file-boundary
behavior, and extension-host recovery remain to be validated. This worker is
one independent execution path, not proof that both dependencies have been
removed.

### Migration progress - first-party Codex app-server adapter

The extension now has an Orchestrator-owned JSON-RPC client for the public
Codex app-server stdio interface documented in the [Codex app-server
guide](https://developers.openai.com/blog/codex-as-a-platform). It initializes
a Codex process using the official CLI's own supported configuration and authentication lookup (the
extension does not read or transfer Codex credentials), starts or resumes a
thread, passes model and reasoning effort, streams visible assistant deltas,
checks the terminal turn status, and interrupts a running turn. Tasks run with
the app-server `workspace-write` sandbox rooted at the approved task checkout;
requests for command/file permissions are surfaced to the user and the
resulting single-use decision is sent over JSON-RPC. Task context includes the
verified local journal and, when available, the Orchestrator's verified AI
Memory task page; the coordinator writes task status/results back through its
managed AI Memory bridge.

When the shared task page and project scope have been verified, the Codex
process receives a process-local MCP server configuration for the same
restricted AI Memory bridge used by Claude. The bridge permits reading the
shared task page and the current attempt page, and writing only the current
Codex attempt page; Orchestrator owns updates to the shared task page. The
adapter checks `mcpServerStatus/list` for a connected server and both expected
tools before starting the turn. A disconnected bridge prevents the turn from
being reported as memory-enabled. The local CLI confirmed that process-level
`-c` overrides expose the temporary server without editing user configuration.
The installed Codex app-server was launched with an isolated profile and the
actual AI Memory 3.4.3 runtime. The integration test confirmed connection,
shared task-page reads, own attempt-page writes with read-back, and rejection
of a worker write to the coordinator-owned page; it did not start a model turn.
Mocked app-server tests also verify scoped arguments and fail-closed behavior.
This does not yet validate a task dispatched from a separate VS Code window.

The adapter was tested with mocked app-server protocol fixtures and a local
Codex CLI handshake using `initialize` and `thread/start` without sending a
model request. This does
not establish compatibility with every installed Codex CLI version or a live
provider session. Model entitlement, authentication, approval callback
behavior, Windows packaging, cancellation, cross-host recovery, and clean
profile runtime behavior still require validation. Claude Code cannot be
treated as equivalent: Anthropic's public third-party product rules restrict
offering Claude.ai login or routing subscription credentials through a
third-party product. The extension must not reuse Claude subscription
credentials through an SDK or token transfer; use only an integration and
authentication flow Anthropic publicly permits, as described in its [legal and
compliance documentation](https://code.claude.com/docs/en/legal-and-compliance).

## Acceptance criteria

- The extension contributes an `Orquestrador` custom agent to the VS Code Chat
  agent selector.
- The Orquestrador has its own chat view in the Secondary Side Bar, is revealed automatically after extension activation, and does not switch to Copilot Chat.
- The Orquestrador appears as a tab in the Secondary Side Bar beside Chat, Codex, and Claude Code, with its own chat composer and conversation list.
- Orquestrador conversations use the selected VS Code Language Model API provider or an explicitly selected, authorized Claude/Codex CLI coordinator profile. Conversations persist per workspace and can consult the Orchestrator task journal; optional project-wide semantic recall may use a verified AI Memory bridge during migration. CLI coordinator results become reviewable plans in the Orchestrator task board. Mutating worker operations remain behind plan approval and task controls. Provider auth is displayed as detected/unverified until a real call succeeds.
- The native Orquestrador custom agent is limited to project read/search, explicitly read-only AI Memory tools, and Orchestrator tools with confirmation for mutations; it cannot bypass plan review through generic edit, execute, or agent tools.
- The Chat or Orquestrador view title gear opens project settings and project preparation;
  no Orquestrador settings view appears in the Activity Bar.
- Build, upstream, and executable settings can be changed in the dialog without
  manually editing JSON.
- The view discovers configured agent CLIs and VS Code model providers without
  listing unrelated task-specific extension agent profiles.
- The final product can register, name, authorize, edit, disable, and remove
  multiple independent profiles for one provider when its documented
  interfaces support separate identities, without replacing another profile.
- The user can select a profile for a task or allow configured routing rules to
  choose among authorized, ready profiles; scheduling respects per-profile
  concurrency limits and can hand off task context to an authorized profile.
- Authentication readiness and usage information distinguish verified,
  unavailable, and unknown states; cost/token figures are sourced or clearly
  labeled as estimates. Unsupported usage data is never fabricated.
- AI Memory calls use an explicit, validated project scope and resolve the
  existing project to its stable ID before writing. Task details expose page
  IDs and distinguish wiki-page verification from managed-workstream/session
  association.
- Before dispatch, the coordinator must write and verify the task's local
  Orchestrator journal record. If that write fails, keep the task blocked,
  release its scheduler reservation, and do not consume an agent attempt.
  During migration, also update AI Memory when its bridge is available, but its
  absence must not block work that has a verified local task record.
- Lich project first-use supports a closed project path: because `worktrees`
  requires an already-open Lich project, the extension may rely on
  `lich open --project <path>` only after verifying through Git that the
  generated branch does not already exist. Any other worktree inventory error
  remains fail-closed. Tasks may explicitly set `worktree: "current"` to use
  the open checkout, including uncommitted files; the coordinator checks for
  an active Lich session on that path and presents this choice for plan review.
- If the user pauses or cancels while AI Memory or checkout preparation is in
  progress, re-read the persisted run state before any further checkout cleanup
  or Lich start. Release the scheduler reservation, preserve the pause/cancel
  state, and do not consume an attempt when no Lich session was opened.
- Configurable limits cover parallel tasks, retries, and estimated budget.
  Parallel-task reservations are shared across Orchestrator windows and separate
  VS Code user-data profiles running as the same operating-system user; live
  Lich sessions are counted where the Lich interface identifies them. Duplicate
  work is avoided unless justified. Separate operating-system user accounts do
  not share the local reservation ledger. Profile switching never serves to
  evade provider quotas, policies, or terms.
- The orchestrator can stop and park Lich tasks while preserving their
  checkout, then continue in the same Claude conversation or start another
  Lich provider in the same checkout with an explicit handoff.
- The agent can initialize `.ai/specs` and `.ai/skills` additively and install
  its bundled generic skills.
- It can check tool availability, list/delegate lich sessions, and invoke a
  configured project build only after configured upstreams update safely.
- Downloads are pinned per extension release and verified before extraction.
- The agent uses ai-memory integrations for project recall and handoff when
  configured, and explains a missing integration instead of claiming memory
  was consulted.
- No domain-specific QEMU, LasecSimul, or fixed project-root assumptions remain
  in active extension instructions.

## Open work

- The native Orquestrador profile cannot start or transfer Lich tasks directly. Starting, retrying, resuming, or handing off production tasks must pass through the Orquestrador tab's persisted, user-reviewable task plan and board.


- The Orchestrator tab now creates an editable structured plan, persists it per conversation, validates dependency cycles, requires plan approval, dispatches allowed Lich providers in parallel with isolated worktrees when Git is available, serializes scheduling across extension-host processes in VS Code windows for the same operating-system user through a lock-protected shared per-OS-user application-data ledger, including separate VS Code user-data profiles; first access imports that profile's previous ledger, reserves each task before dispatch, reconciles session leases against the live Lich session list, counts visible untracked Lich sessions in the same project against the parallel limit (busy, human-blocked, and unknown states occupy capacity; `done` is free), prevents duplicate task dispatch, and fails closed when session state cannot be verified. It checks Lich's live session/worktree inventory before reusing a checkout, parks completed Orchestrator sessions before a dependent task reuses that checkout, stores Lich session/ticket/result metadata across reloads, polls for agent-authored results, periodically records live changed-file lists from each task's Git worktree and updates task memory when those lists change, shows the last 20 observed task events, bounds retries, supports queue pause/cancel and provider handoff, captures a bounded tracked-file diff preview when a result arrives, and requires human review before task completion. Lich v0.85 exposes session state through `sessions --json` and final ticket results through `wait`, but no generic live transcript stream; the event timeline is not the agent's intermediate text output. One read-only task is verified in a Lich-created isolated worktree: session `461a0192f57fa61eb4518ee32adf7f0a` reached `done`, its Claude report and shared AI Memory task page were written and read back, the worktree stayed clean at `df5a668c3595f1f5db15c7008bc57d9a2802ccca`, and an independent `git show` check confirmed the reported version `0.1.1`. The Orchestrator board's final visible state for that run has not been independently inspected. Remaining work: validate the board's result/review state and handoff behavior in the current UI and coordinate reservations across separate operating-system user accounts.
- Pause closes and parks running Lich sessions and preserves their checkouts; resuming starts a new session for each unfinished task with a handoff. It does not suspend and later resume the same provider process.
- The Orquestrador chat supports VS Code Language Model API providers and Claude/Codex CLI coordinator profiles. Claude runs with restricted read-only tools and no MCP tools; Codex runs in its read-only sandbox with user config ignored and strict structured output; it does not enable the automatic approval mode. These CLI calls produce a plan or answer before Lich worker dispatch. The selected Codex/Claude chat extension's private authentication is not reused through a public bridge; CLI profiles use official CLI authentication. Lich worker sessions still use the login configured for Lich/that CLI. Minimal structured-response smoke requests passed through the CLI helper for both providers; the Settings profile-selection and extension-host flow remain unverified.
- Coordinator model and effort are applied on the Claude/Codex CLI path. The VS Code Language Model API has no generic reasoning-effort option, so the extension does not claim to apply effort on that path. Lich worker model and effort defaults are configured separately.
- Lich v0.85.0 itself supports multiple Claude/Codex account profiles and moving a session between accounts in its UI, but its documented `lich open` CLI and MCP interface do not expose that operation. The Orchestrator cannot yet select, enumerate, or verify those worker profiles or their usage. Copilot/Gemini identities and per-profile quota/usage are also not selectable or attributable through the interfaces currently used. Do not rotate accounts to evade quotas or provider limits.
- A Copilot model published through the VS Code Language Model API can serve as the coordinator, but the current Lich provider contract does not include Copilot CLI as a worker kind. AI Memory's separate `run copilot` launcher does not preserve Lich session management, so do not present it as an equivalent worker path. Add Copilot as a worker only after Lich exposes a supported session interface for it.
- The task board and project AI Memory scope settings are implemented; validate their extension-host/webview behavior in VS Code.
- Settings can open the official Claude/Codex CLI login flow for the selected Lich worker and can verify those CLIs through `claude auth status --json` or `codex login status`; no credential material is read or displayed. Other CLI authentication remains unverified unless the provider exposes a supported status command.
- The Orquestrador chat can query `lich cost --json --since 30d` for the current project and displays the known USD cost, priced/unpriced session count, and source when available. This is a project aggregate, not per-account/profile attribution or plan-quota monitoring; unavailable values remain explicitly unknown.
- The 0.1.42 VSIX was installed into a separate VS Code test profile and opened in a second window without restarting the main window. The Orquestrador tab rendered, installed Lich v0.85.0 and AI Memory v3.4.3, and after refreshing displayed the live Lich project report: one session in 30 days, one unpriced, and US$0.00 known cost. The isolated profile has no selected coordinator model; no model request, Lich task, or AI Memory handoff was run.
- The 0.1.43 VSIX was installed and activated in a fresh, separate VS Code profile/window. Its extension-host log records activation. The first cost lookup showed an unavailable report while the verified tools were still installing; after auto-install completed, the extension refreshed automatically and displayed the live 30-day project report (one session, unpriced, US$0.00 known cost), without a manual refresh. No coordinator model was selected and no LLM request, Lich task, or AI Memory handoff was run.
- The 0.1.49 VSIX was installed in a new separate VS Code profile/window without restarting the main instance. The extension-host log confirms activation, the Orquestrador chat view rendered, and the status reported Lich v0.85.0 and AI Memory v3.4.3 installed. No coordinator request, account login, Lich task, or AI Memory handoff was run in this profile.
- The 0.1.51 VSIX was installed into the separate `Code-Orchestrator-Test-051` profile and opened in its own VS Code window while the user's main window remained untouched. The extension-host log confirms activation. The Orquestrador view visibly rendered its conversation list and composer, the successful Lich v0.85.0/AI Memory v3.4.3 installation notice, and the project-level Lich cost report. The user confirmed that the test window opened. This verifies packaging, installation, activation, and UI startup only; no provider login, model request, Lich task, AI Memory handoff, or multiple-account worker routing was exercised.
- A focused scheduler correction now counts live, untracked Lich sessions in the same project against the parallel-task limit. `busy`, `waiting`, and unreported/unknown states consume capacity; `done` does not. Runtime checks cover project filtering, duplicate counting, capacity reservations, and fail-closed behavior when the Lich inventory is unavailable.
- The 0.1.52 VSIX was packaged after refreshing the upstream release manifest; the official latest-release API returned Lich v0.85.0 and AI Memory v3.4.3 with their SHA-256 digests. It was installed into the separate `Code-Orchestrator-Test-052` profile and opened on the workspace without touching the main window. The extension-host log confirms activation and the Orquestrador chat rendered. Both pinned executables were extracted and answered version/status queries. However, after more than five minutes the UI still showed “Baixando e verificando lich v0.85.0”; automatic-install completion therefore remains unverified for this build. No model request, provider login, real Lich task, or AI Memory handoff was run.
- The user confirmed the 0.1.52 test window opened. Its Lich and AI Memory binaries were present and `ai-memory status --json` returned successfully, but the notification continued to show the initial Lich download stage. This proves the tools reached later setup stages but does not establish the cause of the pending progress promise.
- The 0.1.54 build adds a Settings control for maximum task attempts (1–5, including the first dispatch). The Orquestrador prompt receives the selected limit, retry requests are rejected by the task board at the limit, and the UI hides retry and shows the exhausted limit. JavaScript syntax/whitespace checks pass; `npm run package` refreshed stable pins to Lich v0.85.0 and AI Memory v3.4.3 and produced the VSIX. The package was installed in a fresh extension profile. An initial launch accidentally reused the already-open 0.1.53 profile because `ELECTRON_RUN_AS_NODE=1` remained set; that environment variable was cleared and a separate 0.1.54 VS Code process launched. Its extension-host log confirms `local.production-orchestrator` activated, and the Orquestrador view plus successful pinned-tool notice rendered. The 0.1.54 settings form was visually confirmed in its separate test profile; the earlier screenshot was from the 0.1.53 process. Per-task provider/account selection remains unsupported by the documented Lich launcher.
- The 0.1.53 VSIX refreshes the manifest to the current stable Lich v0.85.0 and AI Memory v3.4.3, adds a 120-second release-download timeout, and reports progress after each completed install stage. It was installed into the separate `Code-Orchestrator-Test-053` profile and opened in another VS Code window without restarting or closing the other windows. The extension-host log records activation; the Orquestrador chat rendered; VS Code displayed the success notification for both tools; `lich version --json` returned CLI/server v0.85.0; and AI Memory `status --json` returned v3.4.3 at 127.0.0.1:49374. This verifies automatic installation in that test profile. It still does not identify the exact cause of the 0.1.52 notification issue, and no provider login, paid model request, real Lich task, or AI Memory handoff was run.
- A scheduler review found that a failed `lich sessions` inventory could still allow a new lease to be reserved. Reservation now fails closed when the session list cannot be verified and reports the reason in the task board. The single verified inventory snapshot supplies both lease reconciliation and the reservation baseline, so a second failed lookup cannot slip between verification and dispatch. Focused runtime checks confirm that an unavailable inventory blocks reservation and that a verified empty inventory is read once and permits it; JavaScript syntax and whitespace checks also passed. A real task dispatch has not yet been exercised against Lich.
- The 0.1.44 VSIX was packaged with current stable pins Lich v0.85.0 and AI Memory v3.4.3, installed into a fresh isolated VS Code profile, and opened as a separate window on this workspace. The extension-host log records activation and the Orquestrador view rendered its chat and conversation list. No coordinator model request, Lich task dispatch, or AI Memory handoff was run.
- The 0.1.45 VSIX was installed into another fresh isolated VS Code profile and opened on this workspace without restarting the main VS Code window. The extension-host log records activation and the Orquestrador view rendered. The automatic install notification remained in progress for over three minutes. The pinned executables report Lich v0.85.0 and AI Memory v3.4.3; the AI Memory service answers `status --json`, and an idempotent `setup --yes` reproduction completes in about 1.5 seconds. The notification therefore remains an unresolved UI/runtime issue; no successful automatic-install completion is claimed. No coordinator model request, Lich task, or AI Memory handoff was run.
- The 0.1.46 VSIX was packaged with current stable pins Lich v0.85.0 and AI Memory v3.4.3, installed into a new isolated VS Code profile, and opened in a separate window without restarting the main window. The automatic installation completed and VS Code displayed the success notification for both tools. The implementation now waits for Lich's spawn result and rejects an AI Memory setup timeout even if killing the child does not emit an exit event. This successful run does not establish the cause of the 0.1.45 hang; no coordinator model request, real Lich task, or AI Memory handoff was run.
- The 0.1.47 VSIX was installed into a separate test profile and its VS Code window did open on this workspace; the user confirmed that the test window opened. The extension-host log records activation and the Orquestrador chat is visible. The pinned Lich v0.85.0 and AI Memory v3.4.3 executables are present, and AI Memory `status --json` reports a live service. However, the UI still shows the automatic-install progress notification at “Baixando e verificando ai-memory v3.4.3” after both executables were installed. Therefore automatic-install completion is not verified for 0.1.47 and this UI/runtime issue remains open. No coordinator model request, Lich task, or AI Memory handoff was run.
- Lich's current public `main` README describes experimental provider profiles for some CLIs in the native Providers UI. The public CLI contract still documents no profile flag on `lich open`; the installed v0.85.0 help confirms that gap. This does not provide an Orchestrator-supported per-task account selector. Do not claim multiple account routing until that contract changes or Lich publishes another supported bridge.
- Native AI Memory workstream links and end-to-end cross-provider reads remain unverified. The current bridge writes a shared task wiki page and per-attempt report pages only through the official read/write tools actually exposed at runtime; do not describe these as private agent namespaces or as verified until the UI confirms read-back. Lich launches provider CLIs directly, so it does not establish AI Memory's managed-workstream/session association.
- Separate Claude and Codex CLI coordinator profiles are implemented through official CLI login flows; Claude profile directory paths and the Codex per-profile file credential store are checked before use. This does not yet route profiles to workers. Multiple Copilot/Gemini identities, per-profile usage/quota APIs, and automated profile-aware worker routing remain final-product goals. Lich v0.85.0 exposes account profiles in its UI, while `lich open` lacks a profile argument; AI Memory v3.4.3 profiles apply to `ai-memory run`, not the current direct Lich launch. VS Code extension authentication must not be assumed reusable by Lich CLIs, and account switching must never be used to bypass provider usage limits or terms.
- The 0.1.39 VSIX installed into the isolated VS Code test profile but failed activation because an edit had inserted unquoted text into `src/extension.js`; the extension-host log captured the `SyntaxError`. The issue was corrected, and 0.1.40 was packaged after JavaScript syntax checks, installed into the same isolated profile, and activated after a reload of that test window. The extension-host log records successful activation without a subsequent Orchestrator error, and the Orquestrador conversation view visibly rendered its conversation list, composer, and “Escolha um modelo disponível nas Configurações” state. The workspace was `C:\SourceCode\orchestrator`; the main VS Code window was not reloaded. Release pins are Lich v0.85.0 and AI Memory v3.4.3. The test profile has no coordinator model configured, so no model request or real Lich task dispatch was attempted. Shared scheduling was exercised across two Node processes sharing one global-storage ledger; a real VS Code task dispatch and cross-provider AI Memory continuation remain unverified. The coordinator selector excludes CLI-only providers that do not publish models through the VS Code Language Model API, and saving a stale CLI-only coordinator selection is rejected.
- The 0.1.41 VSIX was packaged with release pins Lich v0.85.0 and AI Memory v3.4.3, installed into a separate VS Code user-data/extensions profile, and opened in a second VS Code window without restarting the user's main window. The extension-host log records activation; the window accessibility tree shows the Orquestrador tab, its conversation list/composer, and the successful tool-install notice for both pinned versions. The isolated profile has no coordinator model selected, so this confirms startup and UI rendering only; it does not verify a model request, CLI login, real Lich dispatch, or AI Memory handoff.
- Validate upstream archive layouts, ai-memory setup behavior, and update flow
  on Windows x64.
- Add and validate Linux/macOS install targets if they are needed.
- Complete migration from the archived Python runner to the extension package
  workflow and document the release process.


The 0.1.55 implementation adds an optional per-plan estimated USD ceiling. The coordinator receives a one-attempt estimate requirement when enabled; approval requires an estimate on every task and rejects an initial plan whose estimates exceed the cap. A lock-protected reservation ledger shared by windows using the same VS Code profile reserves each dispatch/retry/handoff estimate atomically; failed and cancelled attempts stay counted as a conservative forecast. The UI labels per-attempt and reserved amounts as estimates, never actual charges. The estimate is a planning control and cannot reflect real billing or per-account quotas. The 0.1.54 settings form was visually confirmed in its separate test profile; its extension host activated and the Orquestrador view rendered. No Lich task or coordinator model request was run.

The 0.1.55 VSIX was installed into a separate extension directory and launched with an isolated user-data directory. Its extension-host log confirms extension activation. The VS Code CLI wrapper points to a missing cli.js, so this test used the packaged extension contents directly; the main profile was not changed. The 0.1.55 view has not yet been visually inspected, and no coordinator request or Lich task was run.

The pinned v3.4.3 AI Memory `workstreams --json` command returned an empty list in this checkout. Its documented `run` command directly launches supported native harnesses (including Codex, Claude and Copilot CLI), while Lich v0.85.0 `open` starts its own provider session and accepts project, worktree, model, effort and prompt but no AI Memory workstream/session identifier. The extension therefore keeps the wiki-page continuity bridge and reports managed workstream linkage as absent; a native task-to-workstream link remains an unresolved product requirement pending a supported cross-tool API or an architectural change that preserves Lich session management. Focused budget checks also passed for null-estimate rejection, accepted reservation, over-cap refusal, disabled-limit behavior, two-window concurrent reservations under a shared cap, and retry accounting after releasing a session lease.The final 0.1.55 VSIX was rebuilt after the README correction. SHA-256: 5FC05349BE2CC07140A57E92B2498C006ED7C27F1A3668348DD224CCE21AE5F1. Packaging refreshed the release manifest and confirmed Lich v0.85.0 plus AI Memory v3.4.3. Budget checks passed for the shared reservation ledger, including concurrent over-cap dispatch and retries after lease release.

## Registro de requisitos adicionais e validação de janela — 2026-11-06

O arquivo fornecido pelo usuário em `C:\Users\Administrator\.codex\attachments\f5dfe8a9-a6e1-40b3-a492-47656184637d\Texto colado.txt` confirma como objetivo final: múltiplas identidades por provedor; perfis isolados com autenticação oficial; autorização e escolha de perfil por tarefa; execução paralela do mesmo provedor quando oficialmente suportada; roteamento com base em compatibilidade, prontidão, limites verificáveis e preferências; limites configuráveis para paralelismo, tentativas e orçamento estimado; continuidade da tarefa ao trocar agente/perfil; e apresentação honesta de custos, uso e limites desconhecidos. Esses requisitos já estão refletidos nas seções “Multi-provider profiles and usage-aware orchestration goal” e “Acceptance criteria”; não os marque como capacidade entregue sem evidência de API e execução.

O usuário informou corretamente que a janela de teste anterior abriu. Nesta continuação, a versão 0.1.56 foi instalada no perfil isolado `Code-Orchestrator-Test-056`; a instalação do VSIX foi concluída, o host registrou a ativação de `local.production-orchestrator`, e a interface mostrou a aba/chat Orquestrador. A notificação confirmou a instalação automática de Lich v0.85.0 e AI Memory v3.4.3. O chat não tinha modelo coordenador configurado; portanto, não foi feita chamada a modelo, despacho de tarefa Lich, nem handoff de AI Memory. O VSIX instalado tem SHA-256 `21DDED90875C90B828278C676FA6127DC96CE915CAF24FCDB993BE9B2EA39737`. A validação visual das Configurações específicas da 0.1.56 ainda está pendente.

## Registro de validação da 0.1.62 — 2026-11-07

A 0.1.62 foi instalada no perfil isolado `Code-Orchestrator-Test-062` e aberta em uma segunda janela do VS Code no workspace deste repositório, sem alterar a janela principal. O Extension Host registrou a ativação de `local.production-orchestrator`; a interface mostrou o chat e as Configurações do Orquestrador. Na janela isolada, a CLI oficial Claude confirmou o login existente. Após selecionar esse perfil e salvar as configurações, o chat executou a solicitação “Responda apenas com OK.” e exibiu `OK`. A interface identificou o coordenador como Claude, perfil CLI pessoal, modelo padrão da CLI e autenticação verificada. Isso comprova a chamada simples do coordenador pela CLI nesta instalação; não comprova a seleção de um modelo específico, despacho real de worker pelo Lich, nem handoff/continuidade compartilhada pelo AI Memory. O erro `EPIPE` da captura do usuário não ocorreu nesta janela de teste; isso não determina a causa do erro na instalação/janela original.

A 0.1.63 adicionou `worktree: "current"` para tarefas que precisam dos arquivos não commitados e o primeiro uso do Lich agora permite que `lich open --project <path>` abra um projeto antes fechado, após verificação local de colisão da branch gerada. O VSIX foi empacotado com Lich v0.85.0 e AI Memory v3.4.3, SHA-256 `EAAD9184826F3CA7DDEB021A036193C4350D11BE222BD0F082D77763BB310F47`, instalado no perfil isolado `Code-Orchestrator-Test-062` e carregado após recarregar apenas essa janela. No chat desse perfil, Claude gerou e aprovou um plano de leitura com `worktree: "current"`; a extensão confirmou a leitura e gravação do contexto compartilhado no AI Memory (workspace `default`, projeto `josuemoraisgh-orchestrator`) e iniciou a sessão Lich `235a1ff767bb484ef26263d4aeb663b3` no checkout atual. O Lich devolveu `undelivered` e a CLI Claude ficou em um prompt interativo sem entregar o resultado; não houve relatório do agente, portanto o fluxo worker+handoff não passou. A sessão de teste foi fechada com `--worktree keep`, preservando o checkout; a sessão Claude anterior permaneceu aberta. Esse teste não exercitou a verificação de worktree isolada no caminho de projeto ainda fechado. `node --check` nos três arquivos JavaScript alterados e `git diff --check` passaram. O erro de processo principal `EPIPE` não se repetiu na janela isolada e continua sem causa confirmada.

A versão seguinte corrige a persistência da escolha `worktree: "current"` após o início da sessão: o dispatcher agora devolve o marcador `current` ao painel, preservando-o para retry e handoff. Isso evita que uma continuação use silenciosamente uma worktree isolada baseada em HEAD.


## Registro de validação da 0.1.58 — 2026-11-07

A 0.1.58 bloqueia o despacho Lich quando a página compartilhada do AI Memory não pôde ser validada por leitura do escopo, gravação e releitura; libera a reserva e não contabiliza uma tentativa de agente. O teste focado cobriu os caminhos verificado e não verificado. O VSIX foi empacotado após o handler de sincronização confirmar que não há upstreams configurados, usando os releases estáveis Lich v0.85.0 e AI Memory v3.4.3; foi instalado no perfil isolado `Code-Orchestrator-Test-056`. O Extension Host registra ativação de `local.production-orchestrator-0.1.58` e a aba do Orquestrador renderizou após reload da janela de teste. Nenhuma chamada de modelo, despacho real ao Lich ou handoff real do AI Memory foi executado.

A 0.1.59 relê o estado salvo da execução depois da verificação do AI Memory e da preparação do checkout, imediatamente antes de abrir um agente Lich. Uma pausa devolve a tarefa não iniciada para `ready`; um cancelamento a registra como `cancelled`. Ambos liberam a reserva compartilhada e restauram o contador de tentativas. Falha de verificação da memória continua bloqueando a tarefa, a menos que uma pausa/cancelamento tenha ocorrido durante a verificação. Simulações focadas cobriram cancelamento, pausa, pausa durante falha de memória e falha isolada; nenhum caso abriu sessão Lich, e a falha isolada deixou a tarefa bloqueada. As verificações de sintaxe JavaScript e whitespace passaram. O pacote foi gerado depois do handler de upstream confirmar que `.ai/orchestrator.json` não configura upstreams; o manifesto consultou os releases estáveis Lich v0.85.0 e AI Memory v3.4.3. SHA-256 do VSIX: `A5405804A93B6177862BE032EDF67ADA4B8EE9A874659FD912EBB470153E10E4`. Instalado no perfil isolado `Code-Orchestrator-Test-056`; após recarregar somente essa janela, o Extension Host ativou o Orquestrador e o chat renderizou. Uma cópia também foi instalada em `C:\Users\Administrator\.vscode\extensions`, mas a janela aberta com o perfil padrão permaneceu na tela Welcome e não foi possível abrir nela o workspace; portanto, essa tentativa não conta como validação runtime no perfil padrão. Não houve chamada de modelo, despacho real ao Lich ou handoff de AI Memory. O `EPIPE` do processo principal do VS Code informado pelo usuário não se repetiu na janela de teste; sua origem original segue indeterminada e não aparece nos logs do Extension Host.


## Validation record 0.1.66 - 2026-11-07

Version 0.1.66 updates Lich polling to re-read the session state after a ticket answers and to persist the terminal session state when an answer arrives during a pause. A focused test of the pause branch confirmed task status awaitingReview, sessionState done, and the final session detail. The VSIX was packaged after executing the syncUpstreams implementation with the actual upstreams: [] project configuration; it returned: No upstreams are configured; nothing was changed. The release script queried and pinned Lich v0.85.0 and AI Memory v3.4.3, with SHA-256 digests in vscode-extension/upstream-releases.json. VSIX SHA-256: 513DEBD2F92D7B8420E2F4F53260F785D9F9A72AC3D06D86ED942A6CB7587838.

The package was installed and opened in the separate Code-Orchestrator-Test-070 profile. The Extension Host logged activation, the Orchestrator tab rendered, and the UI confirmed installation of Lich and AI Memory. Claude authentication was verified using the official claude auth status --json command and the UI Check action; no credentials were read. No model call or worker task dispatch ran in this version. The test-profile logs contain no EPIPE or broken pipe matches. The project configuration file was not saved during the check. The end-to-end Lich + agent + AI Memory flow and the original EPIPE cause remain unconfirmed for this version.

## Validation record 0.1.67 - 2026-11-07

Added VS Code limited Workspace Trust support so the extension can activate and render its own chat in Restricted Mode. The chat explains how to trust the workspace, disables model input, and does not poll Lich or query usage while untrusted. Model calls, task controls, Lich start/stop, project initialization/settings writes, tool installation, upstream sync, and builds are also guarded in their handlers; the trust-granted event refreshes the UI and resumes recoverable tasks. The package declares `capabilities.untrustedWorkspaces.supported: limited` with a localized description. JavaScript syntax checks and `git diff --check` passed. The package workflow queried and pinned stable Lich v0.85.0 (SHA-256 `07002641aa0166a7234e43927d6ba0a735c820926c94f7110bc8d4307c6a1fbb`) and AI Memory v3.4.3 (SHA-256 `58ad3dc08322dff21b881190d4b2de1a93195b0e33d61d5372a0c563c71eac91`). VSIX SHA-256: `DEE28A4B6ABCFC2F340368584491B64C55E0CA7DB768442317E8AA3B59F71224`. Installed 0.1.67 through the VS Code “Install from VSIX” flow in the separate `Code-Orchestrator-Test-070` window. The extension host log records activation; the UI visibly displays the Orquestrador tab, Restricted Mode notice, and disabled chat input. The clone remained untrusted; no agent, model, Lich task, project write, or trust dialog was invoked. No EPIPE/broken pipe match appears in the test profile logs. The user's active window was not changed.

## Validation record 0.1.68 - 2026-11-07

Corrected the Restricted Mode webview state handler to use explicit DOM lookups instead of relying on `window` globals, and made the composer send path and busy-state button respect workspace trust. JavaScript syntax checks passed. The release packaging script refreshed current stable releases (Lich v0.85.0 and AI Memory v3.4.3) and included the localized Workspace Trust manifest. VSIX SHA-256: `36DD36AA10FEC58CB20D0FB9DDADCB4AE396EE45DE03E6D14787B330ECE38C69`. Installed over 0.1.67 through “Install from VSIX” in the isolated `Code-Orchestrator-Test-070` window, then ran “Developer: Restart Extension Host” only in that test window. The shared-process log confirms 0.1.68 installation and the extension-host log records activation after the restart. Restricted Mode remained active; the Orquestrador view and explanatory notice rendered, the composer input remained disabled, and its Settings panel opened with the test project's existing `.ai` tree identified as preserved. No model request, agent task, project write, trust action, or EPIPE occurred. The user's active window was not changed.

## EPIPE investigation - 2026-11-07

The user's screenshot shows an uncaught `EPIPE` in VS Code's main-process log watcher while writing to its console stream. The isolated `Code-Orchestrator-Epipe-069` profile ran Production Orchestrator 0.1.64; the archived 0.1.64 VSIX contains `console.log(report)` after automatic dependency installation, forwarding the full child-process report through the extension host logger. This is a plausible trigger, not a proven root cause: the profile's saved `main.log` has no EPIPE record and the screenshot exception was not reproduced. Source version 0.1.69 removes extension console logging from installation and view-reveal paths, leaving user-visible progress/results in VS Code UI. Syntax and whitespace checks pass. Building/installing 0.1.69 and reproducing the install in an isolated window remains pending Workspace Trust for the temporary test clone; do not mark the EPIPE resolved until runtime validation succeeds.

The 0.1.70 source keeps automatic-install progress and the final child-process report in a dedicated `Orchestrator-AI` Output channel, with a user-visible action to open it; it does not send that report through `console.log`. Source syntax, manifest JSON parsing, and whitespace checks passed. The package has not been built or runtime-tested at the time of this note.

The 0.1.70 release manifest was refreshed from the GitHub latest stable release API: Lich v0.85.0 (SHA-256 `07002641aa0166a7234e43927d6ba0a735c820926c94f7110bc8d4307c6a1fbb`) and AI Memory v3.4.3 (SHA-256 `58ad3dc08322dff21b881190d4b2de1a93195b0e33d61d5372a0c563c71eac91`). Metadata validation and `git diff --check` pass. Packaging is still gated on the extension's upstream-sync workflow.

Version 0.1.73 uses **Orchestrator-AI** throughout the product and extension
identity: package name, command and view IDs, tool IDs, storage keys, shared
task-slot directory, generated-agent filename and ownership marker, and
display/output names. This project has no compatibility requirement for earlier
identifiers; the renamed extension starts with fresh extension storage and does
not migrate the old generated-agent filename. Version 0.1.73 also corrects the
trust notice visibility so Restricted Mode appears only while the VS Code
workspace is untrusted. The EPIPE path has been exercised in an isolated clone
through automatic dependency installation; no EPIPE entry appeared in that
profile's logs, although this does not prove the original screenshot's cause.

Runtime revalidation of 0.1.73 in `Code-Orchestrator-Test-070` used the user-trusted clone `Orchestrator-E2E-070` and a separate VS Code window. The Extension Host log records activation of `local.orchestrator-ai`; the Orquestrador chat appeared with its composer and without the Restricted Mode notice, and the settings editor opened. The current isolated profile has no authorized coordinator CLI profile or selected model, so no coordinator call, Lich task, or AI Memory task handoff was run. The latest test-window logs contain no `EPIPE`, `broken pipe`, or `ERR_UNCAUGHT` match. The user's active window was left open and untouched.


### Claude Code worker adapter ? first-party session lifecycle
The first-party Claude executor invokes the officially documented Claude Code CLI in non-interactive `stream-json` mode, passes the selected model and effort, resumes only when the same authorized profile owns the prior session ID, and tracks progress/result/cancellation in Orchestrator-owned code. It restricts the built-in tool set, loads only the Orchestrator-owned permission MCP server for non-preapproved calls, and forwards such requests to a one-time loopback HTTP endpoint protected by a random bearer token. The bridge denies file paths outside the task checkout and asks the user before allowing unapproved tool calls. The extension does not read Claude credentials; the official CLI authenticates its own process. A real authenticated task, streamed final event, approval round-trip, cancellation, and handoff still require isolated-window runtime validation.

Implementation note (2026-11-07): Claude Code tasks now have a first-party `claude-code-cli` executor, and the planner routes Claude work to it when the CLI is available. Codex tasks continue through the official Codex app-server adapter. Other CLI providers retain the Lich compatibility executor until their independent session adapters meet the parity gates. `node --check` passed for all extension source and test JavaScript files; `npm test` completed with 17 passing, 0 failing, and 1 skipped test (the optional AI Memory runtime integration). The installed Claude CLI's official `claude auth status` command returned logged-in status. This verifies local CLI authentication only, not a Claude model request through the new adapter. The separate Extension Development Host activated the extension and displayed its Orquestrador chat and settings; no worker task, approval round-trip, or live Claude request was run. Packaging remains gated because `.ai/orchestrator.json` has no configured build or upstreams, so the adapter has not been included in a VSIX. The source check and unit/sidecar tests therefore pass, while provider-backed runtime, cross-window recovery, and package validation remain open.

Implementation note (2026-11-07): coordinator CLI profiles now expose a
configurable concurrent-task limit (1–8, default 1), and the atomic cross-project profile ledger enforces it for tasks explicitly assigned to an
authorized Codex or Claude profile. Tasks assigned to different profiles may still run in parallel subject to the project-wide limit. Worker process IDs are stored with each reservation so a slot is released when its provider process exits. If a host exits before recording a worker PID, the reservation remains fail-closed until the task is recovered or explicitly released. Sessions started outside the Orchestrator remain outside this profile accounting. Focused reservation tests cover
same-profile blocking, independent profiles, cross-project, cross-process races, worker-process exit, and slot release. Extension
storage paths now produce a specific error if VS Code omits the global storage
URI, instead of forwarding undefined to Node path functions; the original
user-reported error's cause remains unconfirmed until runtime reproduction.
Settings UI and separate-window runtime behavior remain to be revalidated in
the packaged extension. The complete `npm test` suite then ran with the
already installed AI Memory v3.4.3 executable from the isolated VS Code test
profile and the installed Codex CLI entry point: 27 passed, 0 failed, 0
skipped. The Codex ↔ AI Memory integration verified page read/write scope and
rejected writes to the coordinator-owned task page; it did not generate a
model response or dispatch from VS Code.

Implementation note (2026-11-07): first-party Git worktree creation now reads
an optional project-root `.worktreeinclude`, selects only Git-ignored untracked
regular files matching `.gitignore`-syntax rules through the direct MIT-licensed
`ignore` 7.0.14 dependency, supports ordered `!` exclusions, skips symlinks and
existing destination files, checks checkout containment, and enforces file-count
and byte limits. Its license is included in `THIRD-PARTY-NOTICES.md`. Selected
files are copied into new task worktrees; existing/reused worktrees are not
reseeded unless a prior copy failed, in which case retries copy only
still-missing included files and preserve existing worktree values. Focused
worktree tests pass 6/6. The
coordinator plan also accepts a local base branch, receives the
available local branch list, resolves the branch to a commit before creating a
worktree, and stores the choice in the task journal. Focused plan/worktree tests
pass 8/8. The full extension suite now passes 30 with 0 failures and 2 optional
AI Memory integration tests skipped (32 total). `npm audit --omit=dev` reports
zero production dependency vulnerabilities. `npx vsce ls` confirms the VSIX
file list includes `ignore`'s runtime entry point, metadata, and MIT notice.
`git diff --check` passes. No VSIX was built: `.ai/orchestrator.json` has
`build: null`, and the
configured build / UI upstream-sync workflow has not been completed. This
verifies source behavior only, not packaged runtime behavior.

Implementation note (2026-11-07): configured upstream validation now resolves
the target's real path at save and sync time, rejects paths that escape through
symlinks, and requires an existing directory plus a non-empty remote. Four
focused path tests pass; the full extension suite passes 34 tests with 0
failures and 2 optional AI Memory integrations skipped (36 total). JavaScript
syntax checks and `git diff --check` pass. Build/package validation remains
pending: `.ai/orchestrator.json` still has `build: null` and no configured
upstreams. The separate VS Code window's UI automation returned
`GetCursorPos: Access is denied`, and its screenshot capture failed, so no
settings were saved and no VSIX was built.

Validation update (2026-11-07): a separate VS Code Extension Development Host
was subsequently opened with `C:\SourceCode\orchestrator` as its workspace,
using a temporary user-data directory and the current extension source via
`--extensionDevelopmentPath`. Its accessibility tree showed the Orchestrator
chat and settings webviews, and its extension-host log confirms activation of
`local.orchestrator-ai`. The fresh session log contains no Orchestrator webview
CSP warning; the earlier warning was from the older host. The output channel
also confirms verified Lich v0.85.0 and AI Memory v3.4.3 assets were installed
in that temporary profile and the compatibility session started. This is
development-host evidence only; no VSIX was built or installed, so packaged
runtime validation remains pending. The build configuration still has
`build: null` and `upstreams: []`; do not claim release validation.
An attempt to configure the build through the Settings webview in that test
window failed at the Windows UI input boundary (`GetCursorPos: Access is
denied`, also through the bundled Windows automation helper). No setting was
saved and `.ai/orchestrator.json` remains unchanged. A candidate VSIX therefore
still needs the supported settings UI to become operable before packaging and
installation can be validated.
The full extension suite was rerun with the pinned AI Memory v3.4.3 executable
and installed Codex CLI enabled: 38 tests passed, 0 failed, 0 skipped. This
includes the shared AI Memory runtime integration across two VS Code windows
and the Codex app-server read/write verification for a task-scoped memory page.
The task journal also no longer emits a duplicate `profileId` field with
conflicting bounds; a regression test verifies the selected worker profile
persists across a retry. The full suite now passes 39 tests with 0 failures and
0 skipped integrations.
The Codex coordinator now passes `--skip-git-repo-check` while retaining
`--sandbox read-only` and `--ignore-user-config`, so it supports generic
non-Git project folders without weakening the execution sandbox. The official
Codex CLI help on this machine confirms the flag allows operation outside a
Git repository. Real minimal coordinator calls through the shipped helper
returned structured `OK` answers from both the authenticated Claude CLI and
Codex CLI, each from a newly created empty temporary directory; neither call
received project files. The Codex path failed before this fix with the CLI's
non-Git-directory refusal and succeeded after it. These checks validate the
coordinator helper and installed CLIs, not invocation through the VS Code
webview or a packaged VSIX.

Validation update (2026-11-07): direct worker-adapter smoke calls from an
empty temporary directory returned the exact response `OK` through the real
Claude Code CLI (`claude-code-cli`) and through the real Codex app-server
(`codex-app-server`), with Claude returning a provider session ID and Codex
returning thread/turn IDs. The Codex call succeeded when the task explicitly
selected `gpt-5.6-luna`, a model listed as API-supported by the installed
Codex CLI's `debug models` catalog. With no model override, the same worker
failed because the user's CLI configuration selects `gpt-6-luna`, which the
installed Codex CLI reported as unsupported for this ChatGPT account. This is
an inherited CLI-default failure, not a credential or app-server transport
failure; model discovery and account-specific availability should be checked
before presenting a model as ready. These direct adapter calls did not attach
AI Memory, did not exercise VS Code webview dispatch, and did not verify
packaged runtime behavior. Their scratch checkouts were removed. Runtime
build/package validation is still pending because the supported settings UI
cannot currently accept input in the separate Windows test window
(`GetCursorPos: Access is denied`); `.ai/orchestrator.json` remains
`build: null`, with no configured upstream repositories.

Implementation update (2026-11-07): Codex task failures now surface a
bounded, credential-redacted CLI diagnostic when the app-server reports a
failed turn, including unsupported-model and authentication cases; otherwise
the previous generic failure text remains. A regression test verifies the
unsupported-model explanation reaches the task state without exposing a
token-shaped string. Focused Codex adapter tests pass 8/8. The full suite was
rerun with the pinned AI Memory v3.4.3 binary and installed Codex CLI enabled:
40 passed, 0 failed, 0 skipped, including shared-memory cross-window and
Codex task-attempt read/write/rejection integrations. This remains source and
adapter validation; configured build and packaged-window validation are still
pending.

Implementation update (2026-11-07): the coordinator settings now populate
Codex CLI model IDs and model-specific reasoning effort choices from the
official installed CLI's `codex debug models` catalog, using the selected,
authorized profile's environment. The extension filters hidden and non-API
models, handles the catalog's large JSON output, rejects stale responses after
profile changes, and tells the user that listing a model does not prove
account entitlement; actual access is confirmed by the first request. Model
catalog parsing and settings-webview JavaScript syntax checks pass. The full
extension suite with AI Memory and Codex integrations enabled passes 42/42.
This remains source validation; VSIX build and packaged-window validation are
pending because the project's supported build configuration has not been set
up through the settings UI.

Implementation update (2026-11-07): task cards now expose an explicit
`Sincronizar memória` action while their AI Memory state is unverified. It
replays the coordinator-owned task-page write with read-back verification and,
when an agent report path exists, retries its verification before persisting
updated local task state. It uses the official MCP bridge and never labels an
unverified write as complete. The AI Memory integration test now covers the
fresh-project bootstrap sequence: resolving a missing project fails, the
initial `memory_write_page` creates a task page, the page is read back, and a
subsequent scope resolution returns a project ID. The full extension suite
passes 42/42 with AI Memory and Codex integrations enabled. The separate
Windows Extension Development Host confirmed the default project scope now
resolves to a project ID; this is a read-only lookup and does not verify the
historical task's existing pages. Build/package validation remains pending:
Windows UI input in the test host still fails with `GetCursorPos: Access is
denied`, so the build configuration was not saved through the settings view.

Design review (2026-11-07): reviewed the current public Lich documentation and
source-repository contracts as behavioral reference only. Useful patterns for
this product are explicit task/session identity, durable task tickets with
distinct pending/answered/failed outcomes, bounded waits that preserve
continuation, provider-specific capability limits, isolated worktrees, and
human-visible session state. Lich itself documents the CLI as its stable
automation contract and its internal HTTP endpoints/database as unsupported;
Orchestrator should therefore keep its own versioned task/session interfaces
and use VS Code APIs or provider-owned protocols rather than reproduce Lich's
private transport. No Lich implementation code or private endpoint was copied
in this review. Inspecting `internal/cli/mcp.go` also confirmed useful design
details: MCP is a stdio JSON-RPC surface, tool failures are returned as
actionable tool results, long work returns a durable ticket rather than
blocking indefinitely, and in-flight MCP calls can be cancelled. The design
lesson is to expose a small, typed, cancellable orchestration tool surface and
persist task identity/results independently of provider terminal output.
Current Lich releases identify AGPL-3.0-only as their license; any later
decision to incorporate source code must first account for that license in
distribution and notices. Reference: https://github.com/lichdotdev/lich,
https://github.com/lichdotdev/lich/blob/main/docs/stability.md, and
https://github.com/lichdotdev/lich/blob/main/internal/cli/mcp.go.

Implementation update (2026-11-07): the complete extension suite was run with
the pinned AI Memory executable and installed Codex CLI integrations enabled:
43 passed, 0 failed, 0 skipped. This includes a real Codex app-server MCP
round-trip that reads the shared task page, writes only its own attempt page,
and verifies that a worker cannot overwrite the coordinator-owned task page; a
real AI Memory integration also confirms the coordinator-authored, explicitly
attributed fallback page. These results confirm the task-scoped bridge and
fallback paths, not a packaged extension build or separate-window validation.
Build/package validation remains pending because the settings UI could not
save the required build configuration in the separate Windows test host.

Runtime follow-up (2026-11-07): a fresh Extension Development Host was opened
with the current workspace and source tree in the isolated profile
`orchestrator-devhost-current-20261107-132007`; its Extension Host log confirms
activation of `local.orchestrator-ai`. The same log still reports that the
Orchestrator created a webview without a CSP, even though the current home and
settings HTML builders include a nonce-based CSP meta tag. The runtime warning
is therefore unresolved; inspect which webview assignment triggers it and
verify again in a fresh host after correction. This development-host check does
not substitute for building and installing a VSIX.

Verification update (2026-11-07): the full extension suite now passes 44/44
with AI Memory and Codex integrations enabled. New coverage calls both actual
webview HTML builders and confirms that the generated document contains its
nonce-bound CSP and script without `unsafe-inline` or `unsafe-eval`. This
confirms the source output only; the fresh-host missing-CSP warning above is
still unresolved. `git diff --check` also passes. No new VSIX was built because
the build configuration has not been saved through the supported settings UI.

Runtime CSP resolution (2026-11-07): the home and settings webview startup order
now assigns the nonce-protected HTML before enabling scripts. In a fresh
Extension Development Host using the current source, the extension activated,
the Orquestrador view rendered in the accessibility tree, and the Extension
Host log reported zero `webview without a content security policy` warnings.
The same startup order is covered by a unit regression test. This confirms the
webview view path; the settings panel itself was not opened in that host, so
its runtime path remains verified by the shared builder and unit test only.
The full extension suite now passes 45/45 with AI Memory and Codex integration
tests enabled. VSIX build/package validation remains pending because the
supported settings UI could not save the build configuration.

Installation progress follow-up (2026-11-07): the notification callback awaited
the informational success/error choice inside `withProgress`, leaving the
install notification active after the underlying work had finished. The
success and error notices are now detached from that callback, and the
Extension Host output records when the progress promise settles. A separate
Extension Development Host using the current source installed the SHA-256
verified AI Memory v3.4.3 and Lich v0.85.0 assets; its output confirms the
private AI Memory server became healthy and the progress promise completed.
The success message appeared without a lingering progress indicator. The
separate default-profile development host did not open the project folder and
reported that no project was open; no build settings were saved there. The
full extension suite passes 42 tests with 3 optional integration tests skipped.
Build/package validation is still pending because `.ai/orchestrator.json` has
no build command and Windows UI automation continues to return
`GetCursorPos: Access is denied`.

Lich backend readiness follow-up (2026-11-07): source study identified that
successful process creation was being reported as a started Lich session. The
Orchestrator now starts the pinned backend and checks the documented
`lich version --json` response for a live server with the expected version
before reporting it ready; it stops the launched process if readiness fails.
The check uses Lich's public CLI contract, not its private transport. Three
unit tests cover delayed readiness, version mismatch, and startup timeout. A
live smoke check against the pinned v0.85.0 executable returned server
version `0.85.0`. The extension suite passes 45 tests with 3 optional
integration tests skipped. This is adapter-runtime evidence, not full
orchestration parity. The extension-development window opened against the
default user profile but did not receive the workspace, and Windows UI input
still returns `GetCursorPos: Access is denied`; `.ai/orchestrator.json` remains
without a build command, so no VSIX was built or installed from this source.

Implementation update (2026-11-07): the CLI-based coordinator now runs the current request through AI Memory's supported `memory_query` tool before planning, scoped to the resolved workspace/project and with bounded, explicitly untrusted historical results. Schema-driven input construction validates the query field and honors the tool's declared limits. Unit coverage verifies request and scope forwarding; the official AI Memory v3.4.3 runtime integration verifies query/readback. The pinned Windows asset was SHA-256 verified before extraction. Full suite with AI Memory enabled: 50 passed, 0 failed, 1 optional Codex integration skipped. `node --check` passed for 39 JavaScript files and `git diff --check` passed. This verifies source and AI Memory adapter behavior; VSIX packaging and packaged-window validation remain pending because `.ai/orchestrator.json` has no configured build command and the separate-window settings UI has not accepted input.

Coordinator retrieval follow-up (2026-11-07): moved the request-specific AI Memory query ahead of coordinator-mode dispatch so both the VS Code Language Model coordinator and CLI coordinator receive the same scoped, bounded retrieval excerpt before planning; VS Code read tools remain available for follow-up queries. With the SHA-256-verified AI Memory v3.4.3 Windows asset, the complete suite still passes 50 tests with 0 failures and one optional Codex app-server integration skipped. Syntax checks passed for all 39 JavaScript files and `git diff --check` passed. No VSIX was built: the separate test-window settings UI remains inaccessible to Windows input, and the project release/build workflow has not been completed.

Handoff delivery fix (2026-11-07): a provider adapter may report a failed delivery as a returned `{status: "failed"}` object instead of throwing. The scheduler now normalizes that outcome, parks any returned session before releasing a claimed handoff, and preserves the session identity if stopping fails or reports `{stopped: false}`. This prevents a false retryable-pending state while a recipient session may still be running. Four focused dispatch tests and six task-journal tests pass; the full suite with AI Memory v3.4.3 enabled passes 54 tests, 0 failures, 1 optional Codex integration skipped. Successful-delivery receipts and crash recovery across the journal/local-state boundary are still incomplete.

Handoff receipt and host-restart recovery (2026-11-07): after a claimed recipient's adapter returns an opened session ID, the task journal records the handoff status `session-started`, recipient, session ID, and timestamp. This deliberately proves session creation/association only; it does not assert the provider read or completed the task. On Orchestrator view refresh, if VS Code workspace state still says `starting`, the view reconciles it against the journal, restores the session identity, and blocks the task with a review/stop/transfer path rather than blindly dispatching a duplicate. Recovery is idempotent and refuses mismatched handoff IDs or unconfirmed `claimed` records. The full suite passes 57 tests with 0 failures and 3 optional integrations skipped; focused recovery and journal tests are included. This does not recover an unreceipted crash between provider session creation and the journal write, nor recover a provider's volatile result/ticket; those cases remain incomplete and are surfaced only as unresolved.

Lich delivery outcomes (2026-11-07): the compatibility adapter previously mapped every non-`pending`/non-`answered` open result to generic failure and treated any successful wait output as an answer candidate. It now preserves the explicit Lich outcomes `unread`, `unanswered`, `undelivered`, `stopped`, and `expired` as distinct `deliveryStatus` values, maps them to a blocked/failed task with a specific user-facing reason, and keeps returned session/ticket identity available for inspection or controlled retry/handoff. Structured wait JSON is checked before exit-code fallback; an unknown structured status is never promoted to an answer. The status is persisted in the local task journal and included in continuation context. Focused tests cover all five outcomes, missing ticket/answer fields, unknown states, structured precedence, and durable status. Full-suite results for this change are recorded after implementation below; a live Lich task was not run.

Validation for delivery outcome handling: `npm test` passes 62 tests with 0 failures and 3 optional integrations skipped; JavaScript syntax checks for all extension source and test files pass; `git diff --check` passes. These are adapter and journal checks, not a live Lich delivery test or installed-extension runtime validation.

Runtime attempt (2026-11-07): `npm run package -- --out <temporary VSIX>` queried current stable releases and packaged the workspace source as `orchestrator-ai` 0.1.73 with Lich v0.85.0 and AI Memory v3.4.3. The VSIX SHA-256 is `7D793B489BBE29AAD63F0CF92F65EEE95E2F61D8A03A4786BC0712774AD0A6DE`; its archive contains `src/lichDelivery.js` and `src/handoffRecovery.js`. VS Code CLI installation into a temporary extensions directory succeeded. Launching the candidate on the previously trusted `Orchestrator-E2E-070` clone in a distinct user-data directory did not produce a new observable VS Code window or Extension Host log, so this is not runtime validation. Separately, a direct read-only Lich CLI experiment created session `9bfed303282b0d526243a0efd112665d` on the current checkout; `lich sessions --json` observed it `busy`, then `done`, and it was closed with `--worktree keep`. No tracked project changes appeared. The CLI did not return a retrievable answer/ticket through the captured invocation, so this verifies session startup/termination only, not prompt receipt, result retrieval, or Orchestrator-mediated delivery. The task's Claude process and its short-lived Lich CLI process were absent on the subsequent process inventory; the pre-existing Lich backend remained running. No process was killed.

Version tag normalization follow-up (2026-11-07): the installed extension reported a false Lich mismatch because the pinned GitHub release tag is `v0.85.0`, while the documented `lich version --json` server field is `0.85.0`. The readiness check now normalizes the optional leading `v` on both values before comparing. The focused Lich runtime tests pass (3/3), including an expected `v0.85.0` tag against server `0.85.0`. A current VSIX was packaged after querying both stable releases (Lich v0.85.0 and AI Memory v3.4.3), SHA-256 `7D43FB3D2049FD1F9DEA1A3F940008A79DE3EE3B1CFE8B2A933344A1AC6DAB29`, and installed into the default extension directory; the installed `src/lichRuntime.js` contains the normalization. A fresh VS Code process was subsequently launched with the test clone and current installed package; its Extension Host log confirms `local.orchestrator-ai` activation, and the Orquestrador chat view rendered. No Lich mismatch was logged, but the test profile had no installed tools and did not run the Lich readiness path. In another default-profile window, the same clone displayed Restricted Mode, so automatic installation was correctly gated and the user's prior trust decision was not assumed to apply to this profile. The clone-only trust request could not be completed through UI automation (`GetCursorPos: Access is denied`). The false-version toast is therefore fixed and unit-verified, but the full installer flow remains to be confirmed in a trusted test profile; the user's active window was untouched.

Release/package and startup follow-up (2026-11-07): `npm run package` queried the latest stable releases and their published SHA-256 digests (Lich v0.85.0 and AI Memory v3.4.3), then created a 95-file VSIX (SHA-256 `B7DC2B6F35037B128E64A6FA11751686ED58937110FB71DF07A90B2512ECE7CA`). Its extracted manifest, license notices, and `src/taskDispatch.js` were verified; tests are excluded. The package was installed in the default VS Code extension directory and opened in a separate test profile with `C:\SourceCode\orchestrator`. The extension-host log confirms `local.orchestrator-ai` activation; the Orquestrador view rendered once, with no CSP warning in the host log. A prior test profile loaded the stale `local.production-orchestrator` folder alongside the renamed extension, so the isolated validation window disabled that legacy ID. This is profile-local test isolation; no user setting or source files were removed. The new auto-install path now waits until the workspace has at least one folder and is trusted, coalesces concurrent setup attempts, and retries when trust is granted or workspace folders change; this avoids the install error seen on VS Code's empty Welcome window. The startup gate test passes. Full suite with AI Memory enabled: 55 passed, 0 failed, 1 optional Codex integration skipped; `node --check` passed for all 43 JavaScript files and `git diff --check` passed. The package window still showed VS Code's GitHub sign-in welcome dialog; no authentication was automated, so model requests and project tasks were not exercised. `.ai/orchestrator.json` remains `build: null` with no configured source upstreams, so this verifies the extension package and startup view, not the project's configured build or complete orchestration workflow. A separate direct `Code.exe` launch attempt produced VS Code's main-process EPIPE dialog; subsequent launches used the corrected Electron CLI with redirected output.

Chat continuity anchor implementation (2026-11-07): the Orchestrator chat now stores a compact anchor in VS Code workspace state whenever its transcript is persisted and refreshes it from saved task runs after view reload. Coordinator context includes the preserved original user objective, latest prompt, latest visible coordinator response, bounded run/task/session state, and a bounded recent transcript tail. Historical text is explicitly labeled untrusted evidence, preventing old conversation content from becoming executable instructions. The full extension suite passes 65 tests with 3 optional integration tests skipped; focused continuity tests pass 3/3; `node --check` passed for 49 JavaScript files and `git diff --check` passed. This verifies source behavior and unit coverage; a separate-window restart/runtime continuity test was not performed. Full event capture, checkpoint pointers, sensitive-data redaction, and arbitrary providers' private transcript import remain incomplete.

Durable AI Memory knowledge interface (2026-11-07): Settings now expose project-scoped `memory_query` search and explicit Markdown page creation through the official MCP tool schema. Creation requires the supported `create_only` flag, rejects absolute/traversing/non-Markdown paths, scopes writes to the configured project, and verifies the saved body and page identity with `memory_read_page`; existing pages are never overwritten. The UI displays result text via `textContent`, disables memory actions in Restricted Mode, and refreshes when workspace trust or folders change. Against the pinned AI Memory v3.4.3 binary, the integration test created an isolated durable page, read it back through a second runtime connection, and retrieved it using scoped `memory_query`. Full suite with AI Memory enabled: 73 passed, 0 failed, 1 optional Codex integration skipped. `node --check` passed for all 51 JavaScript source/test files and `git diff --check` passed. This verifies runtime MCP behavior and generated webview source; the settings panel has not yet been exercised manually in a separate VS Code window. Editing existing pages, source-authority controls, and pinned status remain outstanding.

Separate-window runtime check for the knowledge interface (2026-11-07): launched a fresh Extension Development Host in profile `C:\Users\Administrator\AppData\Local\Temp\Orchestrator-Knowledge-DevHost-20261107`, leaving the active VS Code profile untouched. The launch required clearing the inherited `ELECTRON_RUN_AS_NODE=1` from the child process; the installed `code.cmd` in this VS Code tree points to a missing CLI bundle. The new host's Extension Host log confirms `local.orchestrator-ai` activation; its Orchestrator-AI output confirms SHA-256-verified Lich v0.85.0 and AI Memory v3.4.3 installation and readiness. The window process remains present. Computer-use inspection of the elevated window failed with `GetCursorPos: Access is denied`, so the settings panel was not manually opened and no user-facing runtime claim is made for its controls. No `webview without a content security policy` warning appears in the captured Extension Host log.

Conditional AI Memory page editing (2026-11-07): Settings now load a full page and expose official `memory_patch_page` operations to append at the page end, append within a loaded section, add a section, or replace a section. The Orchestrator uses the loaded `page_id` as `expected_page_id`; section replacement also sends the exact `sha256` returned by `memory_read_page`. The extension-host cache binds opaque page tokens to workspace and project scope, limits retained tokens, and rejects a workspace/scope change before patch dispatch. AI Memory performs the atomic version precondition and preserves page frontmatter. Against the pinned v3.4.3 runtime, integration coverage created a unique page, replaced a section, read back the resulting version, and verified a stale prior page ID was rejected without writing. The complete suite with AI Memory enabled passes 76 tests, 0 failures, 1 optional Codex integration skipped; syntax checks pass for 51 JS files and `git diff --check` passes. The settings controls have not been manually operated in a VS Code window because UI input to the elevated host returns `GetCursorPos: Access is denied`; source and MCP behavior are verified, manual UI behavior is not.

Durable-page metadata and source provenance (2026-11-07): the Settings create-page form exposes AI Memory page tier (`semantic`, `procedural`, `episodic`, `working`), `pinned`, semantic `kind`, tags, and optional source-file paths. Before writing provenance, the Orchestrator verifies each path with literal Git pathspecs, requires the file be tracked and clean, and records the current verified HEAD; it rejects absolute/traversing paths, dirty files, and more than 16 sources. The exact pinned AI Memory v3.4.3 runtime integration confirms tier/pinned values are stored in page frontmatter, and unit tests verify source-path validation and payload construction. Existing-page metadata edits are now exposed in Settings; they use `memory_write_page` with the loaded page ID as a conditional precondition, preserve supported frontmatter and the exact page body, reject unknown or unpreservable metadata, and verify the new page version and requested values by read-back. The runtime represents `pinned: false` by omitting that key, which is treated as false only during verification. Full suite with AI Memory enabled: 83 passed, 0 failed, 1 optional Codex integration skipped; syntax checks passed for all JS files under `src/` and `test/`; `git diff --check` passed. Existing-source changes after creation and manual webview interaction remain unverified.

Schema-driven AI Memory search filters (2026-11-07): the Settings view now asks the active AI Memory runtime for its `memory_query` schema and shows only declared filters. For v3.4.3 these include tier, kind, literal path prefix, exact tag, pinned-first ordering, superseded versions, and ranking details. A selected filter missing from a newer/older server schema fails closed instead of silently broadening search; path prefixes reject absolute paths and traversal. The exact v3.4.3 runtime integration applies all supported filters to a scoped query and confirms the result path; settings-route tests verify filter discovery and forwarding. Full suite with AI Memory enabled: 84 passed, 0 failed, 1 optional Codex integration skipped; syntax checks passed for 53 JavaScript source/test files and `git diff --check` passed. The elevated development host is visible, but UI input still returns `GetCursorPos: Access is denied`; no manual Settings UI claim is made. No VSIX build was run because `.ai/orchestrator.json` has no upstream synchronization entries and build is null.

Coordinator-controlled same-task transfer follow-up (2026-11-07): after read-only Lich source study, the coordinator can emit a bounded structured handoff request through the Codex CLI response schema or the VS Code Language Model tool interface. The extension checks current user intent (or a blocked/failed task), validates the selected existing task, authorized provider/profile, model and effort against available catalogs or recorded configuration, claims the handoff before parking the prior worker, and releases/cancels the claim if the prior session cannot be confirmed stopped. Manual transfer retains its selection UI; automatic transfer does not prompt for a second selection. Tests cover structured parsing, negated intent, task gating, and coordinator CLI schema. Current complete suite with AI Memory v3.4.3 available: 85 passed, 0 failed, 3 optional integrations skipped. Syntax checks and `git diff --check` pass. A separate-window attempt activated the extension, but used an incomplete VS Code 1.141 installation (existing mutex and missing `chrome_100_percent.pak`); it is not accepted as validation of interface rendering or reliable runtime behavior. A usable current VS Code test installation and live provider-to-provider continuation remain unverified. Same-task transfer does not yet provide a general arbitrary-agent task bus or prove that a provider has consumed or completed a handoff.

Current stable packaged-extension validation (2026-11-07): downloaded the official Windows x64 archive for VS Code 1.145.2, matched its SHA-256 against the official `code.visualstudio.com/sha?build=stable` release metadata (`33cf166a751090fe7d244bf0e594e3c69c832d5ae2af1769140ad82a35ea1e0b`), extracted it under a temporary directory, and confirmed its CLI reports version 1.145.2 / commit `c4453f8ea430795f941c1b2ff6c9321135a74a02`. Packaged the current extension as `orchestrator-ai-validation-0.1.73.vsix` (SHA-256 `F80FA72B35BF42203E44142AB50C1C12D04D87E994F965D06302CF8FED5C3E15`), installed it in the Administrator profile's extension directory, and confirmed the installed `src/orchestratorHomeView.js` byte length matches the workspace source. Opened VS Code 1.145.2 in a distinct temporary user-data profile with the current workspace; its Extension Host log records activation of `local.orchestrator-ai`, with no Orchestrator activation error, mutex conflict, missing `.pak` asset, or missing-webview-CSP warning. Accessibility inspection confirms the Orquestrador tab opens automatically in the secondary sidebar and renders its own chat, settings, and new-conversation controls. This temporary profile has not trusted the workspace, so its chat field is correctly disabled by Restricted Mode. Trusting the exact project workspace through Computer Use failed with `GetCursorPos: Access is denied`; no authentication or main-window state was changed. No live provider/model request or cross-provider task continuation was issued; those gates remain unverified. This replaces the invalid 1.141 runtime attempt for activation and automatic-view evidence.


Lich version-conflict recovery and profile diagnosis (2026-11-07): read-only
inspection of Lich's supported CLI behavior informed an independent startup
guard in `lichRuntime.js`. When another Orchestrator window owns a different
Lich backend version, the extension enumerates sessions first, preserves the
server if the session list is non-empty or unreadable, and requests the
documented graceful `lich quit` only after confirming that there are no live
sessions. A cross-window lock serializes the version transition. The pinned
v0.86.0 backend became ready in the isolated profile and reported matching CLI
and server versions; focused runtime tests pass 6/6. No Lich code or protocol
implementation was copied. The full suite with the official AI Memory v3.4.3
binary enabled passes 90 tests, with one optional Codex integration skipped.

The isolated-profile UI exposed an existing configuration boundary: the
workspace selects a Claude CLI profile by ID, but coordinator profiles are
stored in VS Code global state and were not present in that fresh test profile.
The Orchestrator correctly rejects the chat request rather than claiming a
model is available. The chat status now distinguishes an absent or unauthorized
CLI profile and directs the user to Settings. Source syntax checks and
`git diff --check` pass. A new package and validation of this status change
remain pending: the supported upstream synchronization workflow could not be
run through the isolated elevated window because Windows UI input was denied
with `GetCursorPos: Access is denied`. The active Administrator VS Code window
was not changed.


Coordinator status package validation (2026-11-07): packaged the current
source as a temporary test VSIX, SHA-256
`7ee9e6f18db370b174727a7f273e8f6e2e5eab93eb254296f49c98b099d4d008`, and
installed it into the current user's VS Code extension directory. Its installed
`src/orchestratorHomeView.js` hash matched the workspace source. A separate
window using the verified official VS Code 1.145.2 bundle and the target clone
activated `local.orchestrator-ai`, automatically showed the Orquestrador
chat, and displayed the precise missing-profile message for the configured
Claude profile. The same host installed and started the SHA-256-verified Lich
v0.86.0 and AI Memory v3.4.3 assets; the extension output confirms both and
that the progress notification settled. No provider request was sent. The
complete test suite with AI Memory enabled passes 90 tests, 0 failures, and
1 optional Codex integration is skipped; all JavaScript syntax checks pass.
This supersedes the prior pending-package note for the coordinator status
change. The installed Program Files launcher still resolves to a 1.141.0
bundle despite a 1.145.0 payload directory, so it is not accepted as current
runtime evidence. Provider authentication and a live coordinator response
remain unverified; the temporary test profile intentionally has no authorized
Claude coordinator profile. The configured project has no upstream repositories
and no build command, so no project build was run.

Coordinator readiness correction (2026-11-07): extracted CLI profile readiness
resolution into `coordinatorReadiness.js` and require the selected profile ID,
provider, and authorization state to agree before presenting the coordinator
as available. A profile registered for a different provider and a missing CLI
are reported as unavailable; VS Code Language Model mode is evaluated
separately. Six focused readiness tests pass. The full suite with AI Memory
v3.4.3 enabled completes successfully (97 tests; one optional Codex integration
is skipped). This is source-level validation; it does not establish a live
provider response or coordinator task dispatch.

Isolated package check (2026-11-07): built a local test VSIX with the configured
`package:offline` command because the workspace declares no upstream
repositories; this was not a release build. VSIX SHA-256:
`a93a8e68620231545d8ce5c33ae2f8e6637d56711939c3398dc2c948671ff73a`.
Installed it through the verified VS Code 1.145.2 CLI and opened the target
workspace in a separate user-data profile. The Extension Host log records
activation of `local.orchestrator-ai`; packaged `coordinatorReadiness.js`
SHA-256 matches the workspace file. No provider request was issued, so this
confirms packaging and extension activation only, not rendered status or model
execution.

Runtime dependency reduction (2026-11-07): automatic setup and the explicit
"Install / Start" action now ensure only the SHA-256-pinned AI Memory runtime.
The extension no longer downloads or starts the Lich backend during activation;
Lich remains a compatibility path only when a user already has it available.
Readiness reporting calls it optional. Eight focused tests pass, and the full
suite with AI Memory v3.4.3 passes 98 tests with 0 failures and one optional
Codex integration skipped. All changed JavaScript files pass `node --check`,
and `git diff --check` passes. A package/runtime check for this migration is
still needed; the prior activated 0.1.73 test package predates this change.

Memory-only package validation (2026-11-07): packaged the migration as
`orchestrator-ai-0.1.73-memory-only.vsix` (SHA-256
`4362f9823db0ccb4bca69ffe2f16e99fe28f16f7cf36005056cc28f9bd1b2d0e`) and
installed it through the verified VS Code 1.145.2 CLI. Opened the workspace in
a fresh separate profile. Its Extension Host log records activation of
`local.orchestrator-ai`, and the installed `managedRuntimeSetup.js` hash matches
the workspace source. On first startup, the profile's Orchestrator tools
storage contains AI Memory v3.4.3 and no Lich directory or executable. This
confirms the package no longer installs Lich automatically; it does not yet
prove native task execution or provider handoff.

Generic worker configuration (2026-11-07): moved project defaults from the
Lich-specific `lich` configuration key to `workerDefaults` and updated the
current project configuration. Settings can choose any provider with a
verified Orchestrator executor: VS Code tool models, Codex app-server, Claude
Code CLI, or the optional legacy CLI adapter. Unsupported generic effort
settings fail validation; compatibility-executor model/effort limits apply
only when no first-party adapter is selected. The Lich-only continuation path
now ignores a configured VS Code-only default instead of selecting it as a
CLI. Four focused worker-default tests pass; full suite: 102 passed, 0 failed,
1 optional Codex integration skipped. Syntax, JSON parsing, and `git diff
--check` pass. The updated settings view and saved project schema still need
packaged-window validation.

Generic worker package validation (2026-11-07): packaged the worker-default
schema and settings as `orchestrator-ai-0.1.73-generic-workers.vsix`
(SHA-256 `8aed05070380d4c723fd3a556e22b2588c16f14dfbe42dc3cee496e4f86bff7f`).
A separate VS Code 1.145.2 profile activated `local.orchestrator-ai`; installed
`settingsView.js` and `workerDefaults.js` hashes matched the workspace source.
That trusted profile's Orchestrator Output reported AI Memory ready, and its
managed tool store contains the AI Memory executable but no Lich executable.
The output exposed a doubled `v` in the displayed AI Memory version; runtime
setup now normalizes that prefix, with a dedicated regression test.

Current-source package check (2026-11-07): packaged the version-normalization
fix as `orchestrator-ai-0.1.73-final-config.vsix` (SHA-256
`26af6eb3004d137fc85ebfa11a33202df5d15c5d569f74353f24ccd86617f0c5`) and
installed it through the verified VS Code 1.145.2 CLI. The separate host log
confirms extension activation and the installed worker-default module matches
source. That fresh profile did not produce an Orchestrator setup log, so its
AI Memory first-run behavior is not claimed for this latest package. Latest
full suite: 103 passed, 0 failed, 1 optional Codex integration skipped.

Isolated current-source runtime audit (2026-11-07): `npm test` passes 101 tests with 3 optional runtime integrations skipped because the AI Memory/Codex integration binaries were not configured in the development shell. Built a test VSIX with `vsce package --allow-missing-repository` (SHA-256 `1a6bbd523f9f87b044dd3bf24fddd105d39e72156bcb4700377342f69c10c446`) and installed it into an isolated VS Code 1.145.2 profile. Opened `C:\SourceCode\orchestrator` in a separate window; the Extension Host log records activation of `local.orchestrator-ai`, and the packaged `src/extension.js` SHA-256 matches the workspace source (`6e98ef8d494198118a3b7619c57487fc69c9479ee56d395715b77bcf7a842c8d`). The Orchestrator output log confirms AI Memory v3.4.3 installed and ready in that profile's private global storage, with no Lich runtime installed or started. The window was opened, but its chat/settings UI was not visually inspected in this run. No provider request was issued during this initial package-startup check. Subsequent adapter smoke requests and the model compatibility correction are recorded below; parallel scheduling, end-to-end handoff recovery, and diff review remain unverified as indicated in the parity matrix.

Codex model compatibility correction and live adapter checks (2026-11-07): the first Codex app-server smoke request failed before producing an answer because the CLI configuration selected gpt-6-luna, which the active account did not support. Added account-catalog selection for both Codex worker sessions and the CLI coordinator: an unselected model uses the first visible model in the official per-profile catalog and its advertised default effort; an explicitly selected model or effort missing from that catalog is rejected before task worktree creation. Unit coverage verifies catalog defaults and rejection of stale choices, and the mocked coordinator test confirms the chosen model/effort reach the CLI. A repeated live app-server smoke request selected gpt-6-astra / low and returned ORCHESTRATOR_OK with a Codex thread identity. A minimal Claude Code streaming smoke request also returned ORCHESTRATOR_OK with a Claude session identity. Both smoke prompts prohibited tools and file changes; only status booleans were recorded.

Updated package verification (2026-11-07): the current-source test VSIX SHA-256 is b43461490734bd27a7adaaf0e20f7730ecb077e10ad5b95fb8cf633d95f7d037. Installed and opened it in a second isolated VS Code 1.145.2 profile. The Extension Host log confirms activation, the packaged coordinatorCli.js hash matches source (1b9e9bd37f64700f4d8a2373d1f06470b924ee397c9f1d05f928494fb71a6ffd), and the Orchestrator Output confirms AI Memory v3.4.3 is ready in that profile private storage without installing or starting Lich. After configuring the pinned AI Memory executable and official Codex CLI in the test shell, the latest full suite passes all 106 tests with 0 failures and 0 skipped. This includes live AI Memory server sharing across two runtime instances, the Codex app-server scoped memory bridge, and coordinator-attempt page verification. Those integration tests do not use model generation; the separate Claude/Codex smoke requests exercised the session adapter classes directly rather than the full chat-plan and task-journal UI path. No full UI handoff or visual diff review has been claimed.

Live coordinator CLI smoke checks (2026-11-07): with authentication already verified through each official CLI status command, runCoordinator sent one bounded structured-answer request through Codex and one through Claude. Both returned the expected schema-conforming answer. The Codex path used the account-visible catalog selection. These checks do not invoke task tools or mutate project files; they validate the coordinator CLI parser/response path, not the rendered webview or end-to-end task dispatch.

Cross-provider memory handoff and test-window cleanup (2026-11-09): the pinned AI Memory v3.4.4 Codex app-server bridge test passed its scoped MCP read/write and rejected an attempt to overwrite the task-owned page. A real Claude-to-Codex adapter integration then passed: Claude wrote its attempt page through MCP, the Orchestrator read and injected the verified shared task context before starting Codex, and the production read-back path verified the Codex continuation report (worker page or explicitly attributed coordinator fallback). This is adapter-level evidence; the full chat-to-plan-to-dispatch webview path and cross-window recovery remain unverified. Full `npm test` passes 119 tests with 0 failures and 4 optional skips. No Codex lifecycle hooks remain installed in the user's global hooks file. Two VS Code validation windows with dedicated temporary profiles were closed gracefully and their process trees verified absent; the regular user window remained running. Future validation now requires explicit graceful test-window shutdown and process-tree verification in `AGENTS.md`.

Production coordinator workflow integration (2026-11-09): the opt-in integration test authenticates through the official Claude CLI, sends a real planning request through `OrchestratorHomeView.sendMessage`, and confirms the plan stays `awaitingApproval` with zero worker starts. It then invokes the production `approvePlan` and scheduler methods and starts a real Claude Code worker through `ClaudeCodeSessions` in a temporary project. The approval bridge allows exactly one `Write` call to one expected file with the expected token; it denies other tools and paths. The test verifies the actual file contents and worker response, polls through the production task board path, confirms `awaitingReview`, and calls the production review method to reach `complete`. This complete live workflow passed in 18 seconds; no VS Code window was opened, and both the worker process and temporary project were cleaned up. The rendered WebView itself, integration with the extension's production Git-worktree/memory setup during a source-changing task, and cross-window runtime recovery remain unverified.

Production dispatch composition integration (2026-11-09): the new opt-in
AI Memory integration calls the exported production `startClaudeCodeTask`
dispatcher against a temporary Git project and the pinned AI Memory v3.4.4
runtime. It creates a first-party Git worktree, starts the real
`ClaudeCodeSessions` implementation with deterministic provider input, and
uses both actual scoped MCP sidecars. The worker reads the coordinator-owned
task page, creates and reads back its own attempt page, and receives approval
for exactly one `Write` inside the task checkout; the test confirms the source
checkout stays unchanged and the expected file exists only in the worktree.
The full suite with AI Memory enabled passes 122 tests, 0 failures, and 3
optional provider integrations skipped. This composes and verifies the
production dispatcher, worktree, task memory, worker session, and permission
bridge; the fixture does not generate a model response. A real model-generated
source change through this complete path and rendered WebView/runtime
validation remain open.

Live production source-change integration (2026-11-09): the opt-in workflow
now uses an authenticated Claude CLI as both coordinator and worker. The real
coordinator creates a plan in `OrchestratorHomeView.sendMessage`; the test
checks that no task starts before approval, then applies a constrained plan
edit and invokes the production approval/scheduler path. The scheduler calls
the production Claude dispatcher, which creates an isolated Git worktree,
reads the project-scoped task page from AI Memory v3.4.4, and supplies the
scoped read/write MCP tools to the real Claude worker. The permission bridge
approved one exact `workflow-result.txt` write inside that worktree. The test
verified the attempt page by read-back, kept the main checkout unchanged, and
completed review to `complete`. It passed in 57 seconds; the worker process,
managed AI Memory process, and temporary Git project exited or were removed.
This closes the live source-change/production-dispatch gap. It does not
validate the rendered VS Code webview, parallel workers, cross-window recovery,
or a packaged runtime for the current source revision.

Review-to-agent feedback (2026-11-09): the Orchestrator task card now exposes
“Solicitar ajustes ao agente” while a result awaits review and retry capacity
remains. The user enters bounded corrective guidance; the Orchestrator records
it in the task journal and routes it through the same task retry with the
previous result, worktree, provider, model, effort, and adapter-supported
session continuity. The action is hidden after the configured attempt limit.
Focused coverage verifies the UI action, feedback persistence/forwarding, and
attempt-limit enforcement; the full extension suite passes 121 tests with 0
failures and 6 optional integrations skipped. No VS Code window was opened, so
rendered UI behavior remains unverified. Line-specific diff comments and live
provider-stream steering remain outstanding.

Managed AI Memory regression run (2026-11-09): using the already-installed,
SHA-256-verified AI Memory v3.4.4 executable from the Orchestrator profile,
`npm test` passes 121 tests with 0 failures and 3 optional provider integrations
skipped. This run includes the two-runtime cross-window sharing check: both
runtime clients resolve to the same server URL and owner process, and a page
written through one client is read and queried through the other. The live
Orchestrator-home integration also confirms coordinator read-back and
fallback attribution for an agent attempt page. This does not open VS Code
windows or exercise the extension's production Git-worktree preparation for a
source-changing worker; those remain open verification gaps.

Parallel scheduling and task-scoped cancellation (2026-11-09): a production
scheduler integration test with deterministic session adapters proves two
independent tasks enter dispatch concurrently under a configured limit of two.
It verifies both task states and leases, then cancels task A and confirms only
its session stops and lease is released while task B remains running. Separate
unit cases cover cancellation during startup, failed stop preservation, and
review feedback. Run-wide cancellation and startup recovery now also require
an affirmative stop result before marking a task cancelled or releasing its
slot; a negative result leaves the task visible as cancelling and reserved.
Full suite: 128 passed, 0 failed, 6 optional integrations skipped. This does
not claim live-provider cancellation under load or native VS Code runtime
validation.

Current packaged UI and cleanup check (2026-11-09): built and installed
Orchestrator-AI 0.1.76 from the current source in a separate VS Code 1.145.2
window using a dedicated user-data directory. The VSIX SHA-256 is
`76C60B9E24E0D96269EE035399151E00BB17C29AD0510E2F634908F64C3D4DAC`; its
release metadata pins Lich v0.87.0 and AI Memory v3.4.4 with published archive
digests. The Extension Host log confirms `local.orchestrator-ai` activation;
the managed runtime reports AI Memory v3.4.4 ready. Accessibility and visual
inspection confirm the Orquestrador view opens automatically and renders its
own conversation, new-conversation control, and settings control. The isolated
profile had no authorized provider account, so no model request, settings
workflow, worker dispatch, or authentication reuse is claimed from this UI
check. The candidate window was closed gracefully and every process using the
dedicated VS Code test installation exited; the regular VS Code windows were
left open.

Line-specific diff review comments (2026-11-09): the task review card now offers
“Comentar linha do diff” when a verified diff preview exists. The coordinator
asks for a relative `path:line` and comment, re-reads the task worktree diff,
and accepts only added lines in a complete, non-truncated preview. It records
the file, line, and comment in task history and forwards the note as bounded
guidance through the existing retry for that same task. Unsafe/invalid paths,
unchanged lines, unavailable diffs, and truncated diffs fail closed. Focused
syntax checks and 12 related tests pass. Visual interaction and a real provider
continuation from this exact UI path remain unverified; no VS Code window was
opened for this change.

VS Code model consent reporting (2026-11-09): model readiness now reads the
official `LanguageModelAccessInformation.canSendRequest` result without
triggering consent. The Orchestrator distinguishes access confirmed, access
blocked, first-request consent required, and access state unknown; it refuses
to send when VS Code reports blocked access, and lets the user-triggered
`sendRequest` initiate first-time consent when needed. The chat and Settings
refresh after either contributed model-list changes or model-access changes.
Focused model-access, readiness, and webview tests pass. Manual allow/deny
consent, quota failure, and live provider add/remove behavior remain to be
verified in VS Code.

Settings webview loading fix (2026-11-09): isolated VS Code 1.145.2 runtime validation of Orchestrator-AI 0.1.77 confirms the Settings panel renders live state for `C:\SourceCode\orchestrator`, including `.ai` status, provider controls, memory scope, build/upstream controls, and save action. The root cause was literal newlines emitted inside quoted strings by the generated inline webview JavaScript, preventing the client script from parsing and leaving the static loading screen indefinitely. Escaping these newlines fixes script parsing. Regression tests compile the generated script, verify all referenced static element IDs exist, and execute the state-message path against a fake DOM to confirm project state rendering. The candidate ran in a dedicated profile and extension directory; its window was closed gracefully and its process tree exited. No provider login or model request was performed.

Managed-memory integration revalidation (2026-11-09): ran the pinned AI Memory v3.4.4 runtime integration and production Claude dispatcher integration with `ORCHESTRATOR_AI_MEMORY_BIN` pointed at the executable already installed by Orchestrator. The runtime test confirmed that two runtime clients share one server, `memory_resolve_write_target` returns the stable project ID for an existing scope, and scoped pages can be written, read, and queried across clients. The dispatcher test confirmed the production path creates an isolated Git worktree, verifies task context through the scoped AI Memory bridge, permits one exact fixture write, and reads the worker's attempt report back. Both tests passed; the provider fixture is deterministic and no model request was made. The generated Orquestrador chat script also compiles under `vm.Script`; this protects it against the settings-webview parse regression. Cross-OS-user reservation sharing, actual model-generated source changes through this live path, and remaining full product parity are still open.

Isolated account-profile regression coverage (2026-11-09): added tests for the official CLI profile boundaries used by Orchestrator. The tests verify distinct `CODEX_HOME` and `CLAUDE_CONFIG_DIR` paths, removal of inherited provider credential variables from isolated profile processes, Codex's required file credential store, rejection of profile IDs that could escape extension storage, and preservation of unexpected existing Codex configuration. These mechanisms are documented by OpenAI and Anthropic respectively; this test suite does not inspect or copy credential files and makes no provider request. Focused profile tests pass 3/3; full `npm test` passes 143 tests, 0 failures, and 6 optional integrations skipped. AI Memory and production-dispatch integrations were run separately against the pinned v3.4.4 runtime in the preceding validation record.

Portuguese UI encoding repair (2026-11-09): corrected mojibake in 96 lines across six extension source files, including Settings labels/notices, coordinator and worker errors, and progress messages. Added a webview regression asserting representative Portuguese strings and rejecting the observed mojibake patterns. The full suite passes 144 tests, 0 failures, and 6 optional integrations skipped. Packaged as Orchestrator-AI 0.1.78 after refreshing the stable upstream manifest (Lich v0.87.0; AI Memory v3.4.4). In an isolated VS Code 1.145.2 window, the Settings webview accessibility tree showed correctly accented Portuguese throughout; the Extension Host log records `local.orchestrator-ai` activation and the Orchestrator Output log records AI Memory v3.4.4 ready. The candidate window was closed gracefully and its process tree exited; no provider account was available in that isolated profile, so no model request was made.

Current-source live coordinator and worker verification (2026-11-09): the installed official Codex and Claude CLI profiles both returned `verified` from their documented auth-status commands. The Codex account catalog returned four API-enabled models. Through the production `runCoordinator` implementation, both CLIs returned the requested schema-conforming `answer` without a plan or handoff. Then `liveOrchestratorWorkflow.integration.test.js` passed against the current source in 67.4 seconds: a real Claude coordinator produced a plan that remained pending until approval, the production scheduler/dispatcher launched a real Claude Code worker in an isolated Git worktree with AI Memory v3.4.4 context, the exact approved file write was read back, and human review reached `complete`. No writes occurred in this checkout. The temporary project, worktree, and test processes are absent. These checks verify the official CLI integrations; they do not verify that private authentication from VS Code's Codex/Claude chat extensions can be reused, and no model quota/usage telemetry was queried.

Authentication and provider boundary audit (2026-11-09): reviewed the current official VS Code Language Model, Authentication, and agent-harness documentation, plus Anthropic Claude Code authentication policy. Orchestrator uses `vscode.lm.selectChatModels`, `LanguageModelAccessInformation.canSendRequest`, and `LanguageModelChat.sendRequest` for models the editor publishes; this lets the registered model provider own its authentication and consent flow without Orchestrator reading tokens. The VS Code Authentication API can share a session only through a named `AuthenticationProvider` and its normal per-extension access grant; it does not grant access to another extension's private session store. The public API reference documents model selection and authentication providers, but no public extension API for creating or controlling another extension's private Codex/Claude chat session was found. Therefore native chat sessions stay independent; orchestration uses the VS Code Language Model API where the model is exposed, or the provider's own supported CLI/app-server flow with that profile's separate official authentication. Claude subscription credentials must not be intermediated by a third-party product; the official Claude Code executable is used directly for user-authenticated local sessions. This audit is documentation/source review only; no provider account or model request was used. References: <https://code.visualstudio.com/api/references/vscode-api>, <https://code.visualstudio.com/docs/agents/run/agent-harnesses>, <https://code.claude.com/docs/en/legal-and-compliance>.

Managed-memory credential redaction (2026-11-09): added one bounded shared redactor for task-journal snapshots/events, coordinator-owned AI Memory task pages, coordinator fallback attempt pages, and the task-scoped MCP server used by Codex and Claude workers. It removes quoted or unquoted common credential assignments (including quoted values with spaces), Bearer/Basic credentials, recognized OpenAI/GitHub/GitLab/Slack/NPM/Hugging Face/Google token forms, and PEM or PGP private-key blocks before those bodies are sent to the managed AI Memory runtime. Codex diagnostics also use the same rules. Focused tests and the complete suite pass: 153 passed, 0 failed, 3 optional integrations skipped with the installed AI Memory v3.4.4 runtime enabled. An additional real MCP bridge test wrote an agent attempt containing fictitious multiword-password and GitHub-token values; AI Memory reported a verified write, and a subsequent read confirmed both values were absent while continuity markers remained. Packaged Orchestrator-AI 0.1.80 after refreshing latest stable upstream release metadata (Lich v0.87.0; AI Memory v3.4.4); VSIX SHA-256 `4b125883de5b4f91d841945997c2731a3e7a97ddf70d3b85be0db63f2e20d45b`. Installed and opened it in a dedicated VS Code 1.145.2 profile; the Extension Host log confirms `local.orchestrator-ai` activation and the Orchestrator output confirms AI Memory v3.4.4 ready. The test window was closed gracefully and its process tree exited; regular VS Code windows remained untouched. This does not verify arbitrary secret formats, direct provider chats outside Orchestrator, or live provider quotas/usage.


Retry-stop safety (2026-11-09): retrying a failed or blocked task now requires either a known terminal prior-session state or an affirmative stop/terminal response from the adapter. If the adapter reports busy, returns an unknown state, or throws, the task stays running with its original session ID and shared slot reactivated; no second attempt is scheduled. Failed poll outcomes persist their session state so a known-terminal worker can be safely retried without another stop request. Focused retry/cancellation tests pass, and the complete test suite passes 155 tests, 0 failures, and 3 optional integrations skipped with AI Memory v3.4.4 enabled. Packaged as Orchestrator-AI 0.1.81 after refreshing stable upstream release metadata (Lich v0.87.0; AI Memory v3.4.4). VSIX SHA-256: 1f204907b2d72a6d584847eba81babfe9b2f77e5a4f28569565e0b372ac65ccf. A dedicated VS Code 1.145.2 profile confirmed local.orchestrator-ai activation in the Extension Host log and AI Memory v3.4.4 readiness in the Orchestrator output. The test window was closed gracefully and all profile processes exited; the regular VS Code window was left untouched.


Cross-window Codex session polling (2026-11-09): when a second VS Code extension host polls a Codex app-server session it does not own, it now keeps the task pending while the journal-recorded owner process is alive, consumes a completed or failed result from the shared task journal, and marks the task failed only when the owner exited without recording a result. Tests cover the three owner/result states plus a real two-client TaskJournal integration where a second poller sees the live owner and later reads its completed result. Full suite with AI Memory v3.4.4: 159 passed, 0 failed, 3 optional integrations skipped. Packaged Orchestrator-AI 0.1.82 after querying current stable upstreams (Lich v0.87.0; AI Memory v3.4.4). VSIX SHA-256: a5ebebabac545fc6a8e213c2f4d23b4e24109bba959a14301e7d93e0a2e12b5d. Installed into a dedicated VS Code 1.145.2 profile; the Extension Host confirmed local.orchestrator-ai activation and the Orchestrator output confirmed managed AI Memory ready. The test window closed gracefully and all test-profile processes exited. This verifies polling logic and packaged startup; a live two-window provider task is still unverified.


Retry slot restoration (2026-11-09): if stopping an existing agent is not confirmed and its shared slot was already pruned, the Orchestrator now recreates the running task/profile lease before returning. The original session ID, provider, worker PID, project path, and worktree are retained; it does not schedule a duplicate attempt. Focused retry and slot tests pass; the complete suite passes 159 tests, 0 failures, and 3 optional integrations skipped with AI Memory v3.4.4. Packaged Orchestrator-AI 0.1.83 after refreshing stable release metadata (Lich v0.87.0; AI Memory v3.4.4), VSIX SHA-256 aff7cf55ae72971a233a4e9fca9a0ebba1773b5574fc4f58668ba632816dbca0. An isolated VS Code 1.145.2 profile confirmed extension activation and managed AI Memory readiness; all test-window processes exited cleanly. A live provider-stop failure in a two-window VS Code run remains unverified.

Packaged UI validation (2026-11-09): installed Orchestrator-AI 0.1.84 from its VSIX into a dedicated VS Code 1.145.2 profile and opened the target workspace in a separate window. The accessibility tree confirms the `Orquestrador` secondary-sidebar tab is automatically visible, its own chat view and composer render, and its settings action is present; the Extension Host log confirms `local.orchestrator-ai` activation and the output log reports managed AI Memory v3.4.4 ready. Because this isolated profile has no registered Claude CLI profile, the chat correctly reports that the configured profile is unavailable here; no authentication or model request was attempted. The window closed gracefully and its process tree exited. This first pass verified automatic view/chat rendering and packaged startup; the Settings action was validated separately below. An authenticated coordinator request and provider task execution from this profile remain unverified.

Packaged Settings-panel validation (2026-11-09): in the same dedicated VS Code 1.145.2 profile, a temporary test extension invoked the registered `orchestratorAi.openSettings` command through the public VS Code command API. The resulting `Orquestrador: Configurações` webview rendered its project initialization status; coordinator provider/profile/model/effort controls; worker defaults and allowed agents; parallelism, retries, and budget; AI Memory scope/search/create/edit controls; build and upstream settings; and save action. The accessibility tree confirms the controls and current project data are present, including the explicit missing-CLI-profile state. The Extension Host exited cleanly and all test-profile processes were absent afterward. This did not activate a login flow, save configuration, write an AI Memory page, or send a model request; those interactive actions remain unverified.

Coordinator readiness composer fix (2026-11-09): the packaged chat previously left its input and Send button enabled when CLI readiness reported that the selected profile was missing or unauthorized. Its client script also called the removed `drawUsage` function while processing state, which could interrupt further state updates. Removed that stale call, disable the composer until both workspace trust and coordinator readiness are true, keep it disabled while a request is busy, and show a Settings-directed placeholder when the coordinator is unavailable. Focused webview tests exercise unavailable, ready, and busy states and confirm unavailable messages are not sent; the full suite passes 157 tests with 7 optional integrations skipped. Packaged `orchestrator-ai-0.1.85.vsix` after the release workflow queried Lich v0.87.0 and AI Memory v3.4.4; VSIX SHA-256 `A294E27CE51EE914CC4363E180EF5B97B53573DC904BB3994C3468B885920842`. Installed in a dedicated VS Code 1.145.2 profile; the accessibility tree confirms the input and Send button are disabled and the placeholder directs to Settings when the configured Claude profile is not registered in that test profile. The installed source hash matches the workspace source (`B366C52D50C27A0C416261D6D437F130C261736FE63FB708FE70B1E506D14A7D`), AI Memory v3.4.4 reported ready, and the test window and process tree exited cleanly. No authenticated request was made.

Coordinator CLI profile recovery action (2026-11-09): when the configured provider profile is absent from the active VS Code profile, the Orchestrator chat now offers an explicit ?Verificar login CLI atual? action. The composer remains disabled until recovery succeeds. Recovery is offered only when the missing ID can safely bind to the selected provider; the host rechecks workspace trust and readiness and continues using the existing official CLI verification plus user confirmation flow. Tests cover safe eligibility, button visibility, and command dispatch. Full suite: 158 passed, 7 optional integrations skipped. Packaged 0.1.86 after querying stable Lich v0.87.0 and AI Memory v3.4.4; VSIX SHA-256 FB73A3B38DFBCA2F644EB5317A50CFC306D4F13D564704AD19023280C8573D31. An isolated VS Code runtime window could not be opened because the installed launcher references a missing cli.js; runtime validation is not claimed.

Isolated VS Code runtime verification (2026-11-09): installed the 0.1.86 VSIX into a dedicated user-data and extensions profile and opened it with the target workspace, leaving the user's active window untouched. The accessibility tree showed the Orchestrator view, the ?Verificar login CLI atual? button, and the message field plus Send button disabled while the saved Claude profile was absent from this isolated profile. The isolated extension-host log confirms local.orchestrator-ai activation; the Orchestrator-AI output log reports AI Memory v3.4.4 ready in the isolated storage directory. No login recovery or authenticated model request was made. The window was closed with CloseMainWindow and every process carrying the isolated profile path exited. This supersedes the earlier runtime limitation for this exact 0.1.86 build.

AI Memory runtime integration validation (2026-11-09): using the AI Memory v3.4.4 executable installed in the closed 0.1.86 isolated VS Code profile, ran the full extension suite with ORCHESTRATOR_AI_MEMORY_BIN set: 162 passed, 3 skipped, 0 failed. The enabled cases verified two runtime instances reuse the same managed server and one can read a create-only task page written by the other, the scoped Claude/Codex MCP bridge redacts secrets, and the production Claude dispatcher fixture creates an isolated Git worktree and verifies the task and attempt pages through the managed runtime. These tests make no provider model requests. The three skipped tests require Codex app-server/provider credentials or live provider handoff configuration. The temporary runtime test processes exited; existing AI Memory processes from the user normal and earlier test profiles were left untouched. This validates runtime sharing and task-page continuation mechanisms, not a true cross-window handoff between live provider sessions.
