# Strict-zero network policy

`strict-zero` is a host policy. It is not a prompt instruction and it is not
the boolean shown in a model context.

`ExecutionBroker` maps strict-zero to the process runner's deny policy and
checks the original command text before spawning the child. Network-capable
commands (HTTP clients, package downloads, remote Git operations, network
intent, recognized language/runtime network calls, and opaque runtime script
entrypoints) are rejected with a typed permission failure. Shell commands are
checked using the same original text rather than the encoded portable-shell
transport.

The model-facing broker also uses a fail-closed local process allowlist when
there is no native OS adapter. Repository search, read-only Git inspection,
version probes, and the configured local test commands are allowed; arbitrary
executables and script files are denied before spawn. Trusted host callers may
use the compatibility mode explicitly, but that mode is not model authority.

On Windows, every process the broker spawns is driven through
`CreateProcessW` directly (`src/shared/win32/isolated-process.ts`, bypassing
`Bun.spawn`, since a process's security context can only be set at creation
time) and assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
That is a real, OS-enforced guarantee, independently verified: terminating
the job kills the spawned process **and every descendant it created**, not
just the one process the host holds a handle to — a gap that plain
`child.kill()` has on Windows (verified: a `ping.exe` grandchild survived
killing only its parent). This is unconditional; `ProcessResult.isolation.
osEnforced` reports it wherever it applies.

A second, independent mechanism exists for real network denial: a
zero-capability AppContainer (no `internetClient`/`internetClientServer`/
`privateNetworkClientServer` capability), which Windows Filtering Platform
denies both inbound and outbound network access to by default — verified
directly against a live host (`ping`/`curl` both failed inside the container
while succeeding outside it). Because an AppContainer token's DACL checks
are additive on top of the normal token, the workspace root needs an ACL
grant (`ALL APPLICATION PACKAGES:(OI)(CI)RX`, applied recursively and cached
per root — see `grantWorkspaceAccess` in `src/shared/win32/app-container.ts`)
before a sandboxed process can read it at all; without that grant, every file
read inside the container fails with `ACCESS_DENIED`, verified directly. This
mechanism is implemented and covered by `tests/unit/win32-app-container.test.ts`,
but is **not yet wired into the default execution path**
(`denyNetwork: false` in `src/shared/process.ts`): `git` fails inside the
AppContainer with `unable to get current working directory: Permission
denied` in a fresh, otherwise-accessible directory, or with `CreateProcessW`
itself intermittently failing (`ERROR_DIRECTORY`) against a large real
repository — neither reproduces with `cmd.exe`/`dir`/`type` against the same
paths, so it is not simply the ACL gap the workspace grant already closes.
Given how central `git`/`RunTests` are to the product, this is disabled by
default until that failure mode is root-caused, rather than shipped as a
silent, unverified claim. `ProcessResult.isolation.networkEnforced` is the
honest per-call signal for whether this specific mechanism actually applied;
today it is always `false`.

No paid route is enabled by either mechanism. Routing privacy/cost gates
remain a separate prerequisite, and a weaker broker cannot be substituted for
a strict-zero task.
