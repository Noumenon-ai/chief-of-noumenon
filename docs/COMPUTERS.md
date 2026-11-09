# Agent computers

An agent can have its own computer: an isolated machine where its turns run
their commands and file edits instead of on the machine running Chief of Noumenon.
Local Docker computers can be a shell or an isolated Linux desktop with screen
tools, live viewing and takeover. In the Desktop app, a person can also choose
a Boat cloud computer. Cloud computers have internet access, use a separate
  provider account and may incur charges; their files are not synced with the
  local workspace. The Boat API key is encrypted in the local Desktop profile
  and sent by its backend to Boat's API over HTTPS for authentication. It is
  never sent to the agent or cloud computer. Cloud
computers auto-archive one hour after creation or resume, and can be resumed by
a later turn when auto-start is enabled. The macOS desktop app also offers a
separate, explicitly enabled [native desktop preview](NATIVE-DESKTOP.md) that
acts on this Mac's apps. Remote SSH computers remain unimplemented.

Desktop computers also expose structured `browser_*` tools for their own
Chromium browser. See [the image setup](../desktop-image/README.md) and
[browser tools](BROWSER.md). Rebuild the local image and recreate older desktop
computers to install Chromium and the CDP broker.

Status: experimental and opt-in. Automated coverage uses a fake `docker`
executable and scripted provider CLIs; provider tests against a real Docker
daemon run only when Docker is answering and the image is already present (see
[Testing](#testing)). Focused macOS source-build checks have also exercised the
real Docker lifecycle, computer tools, desktop preview and take-control flow.
These checks do not establish broad engine, platform or security coverage.

## What it does

- **One computer per agent.** `POST /api/v1/agents/{id}/computer` gives an
  agent a computer. From then on, every turn of every conversation with that
  agent runs its tools in that computer, and the host's own tools (Bash, Write,
  Edit, Read and the rest) are off for those turns.
- **Only the workspace is shared.** The agent's workspace folder (the folder
  its conversations are pinned to) is bind-mounted at `/workspace`. Nothing
  else from the host is mounted. Files written there are the person's own files
  on the host; everything else inside the container is disposable.
- **Every call is approved.** A computer call goes through the same approval
  gate as a host call: the card, saved command rules, the safety floor, the
  approval mode and the decision log. The card says the call runs in the
  computer.
- **No fallback to the host.** If an agent has a computer and it cannot be
  used (Docker is stopped, the image is missing, the container was changed by
  hand), the turn fails with `computer_unavailable` and says why. It never
  quietly runs on the host instead.

## Data model

One table, `computer` (migration `4b7e1d9c2a58`), at most one row per agent:

| Column | Meaning |
|---|---|
| `agent_id` | The agent (unique). No foreign key, like `thread.agent_id`: a row outlives its agent until its machine is removed. |
| `provider` | `docker` for a local isolated computer or `boat` for a Desktop cloud computer. The native macOS desktop preview is a separate, opt-in app path; SSH computers are not implemented. |
| `image`, `image_id` | The image reference (a digest pins it) and the content id it resolved to when the machine was made. |
| `cpu_millis`, `memory_mb`, `pids_limit` | Limits. CPU is stored in thousandths so the column is an integer on every database. |
| `network` | `none` (no network at all, the default) or `default` (Docker's bridge: internet out, nothing in). |
| `idle_minutes` | Stop after this many minutes without a turn or a command; 0 never. Default 30. |
| `auto_start` | A turn may start a stopped computer, or make a missing one from an image that is already here. Default on. |
| `state` | `missing`, `creating`, `running`, `stopped`, `error`, `deleting`: the last state the app saw. |
| `workspace_path` | The folder mounted at `/workspace` when the machine was made. |
| `container_id`, `last_error`, `last_used_at` | What the provider last reported. `provider_generation` gives each newly created provider resource its own idempotency identity. `provider_delete_id` tracks an accepted cloud deletion; if Boat no longer has that operation record, the app checks the sandbox and either finishes removal or requests a new deletion operation. |

On SQLite the id is `AUTOINCREMENT`: the container name is derived from it and
must never be handed to a different computer.

The local Docker machine's own name is `open-dots-computer-<installation>-<id>`, where
`<installation>` is the start of a random id kept in `computers/instance-id`
in the data folder, so two installations sharing one Docker never touch each
other's machines.

## Lifecycle

```text
(no row) --give a computer--> missing --start--> running --stop--> stopped
                                 ^                  |    <--start--    |
                                 +-----recreate-----+------------------+
any state --remove--> deleting --(machine removed)--> (row gone)
```

- **Giving a computer never touches Docker.** It only makes the row. The call
  is idempotent: an agent that already has one gets it back unchanged.
- **Downloading is explicit.** `POST /computers/{id}/prepare-image` is the
  only step that downloads an image. Starting a `missing` computer makes the
  machine only from an image that is already on this machine; a turn never
  downloads one.
- **Creating is idempotent.** If a machine with the computer's name exists and
  carries this installation's labels for this computer, it is kept (started if
  stopped). A container someone else made under that name is refused, never
  reused or removed.
- **Ownership and hardening are checked before every use**, not only at
  creation: a container whose labels, capabilities, user, ports or mounts were
  changed by hand is refused (`foreign` or `unsafe`) and must be recreated.
- **Limits change live.** CPU, memory and process limits are applied to the
  running machine with `docker update`. The image, network, folder and user
  are fixed when the machine is made: changing them sets `needs_recreate`, and
  **Recreate** removes the machine and makes it again (the workspace folder is
  kept).
- **One step at a time.** Every lifecycle step for one computer runs under
  that computer's lock.
- **Turns hold a lease.** A turn holds its agent's computer from start to end.
  Stop, Recreate and Remove are refused while a turn holds it.
- **Idle stop.** Every 30 seconds the upkeep job stops a running computer that
  has had no lease and no command for `idle_minutes`.
- **Removal is journalled.** Removing a computer first marks the row
  `deleting`, then removes the machine, then the row. If Docker is not
  answering, the row stays `deleting` (hidden from every list) and the upkeep
  job finishes the removal when Docker comes back. Boat deletion is asynchronous:
  the app tracks the provider's deletion operation; if that operation expires,
  it checks whether the sandbox still exists before clearing the row or asking
  Boat to delete it again. Removing an agent removes its computer the same way.
  Removal never touches the workspace folder.
- **Orphans.** The first time the upkeep job finds Docker answering (at startup
  or later), it removes machines this installation made that no row knows of
  (for example after restoring an older database).

## The container

`docker run` with:

- a non-root user: the host user's own uid and gid (so files written in the
  workspace are the person's), never root;
- `--cap-drop ALL` and `--security-opt no-new-privileges`;
- `--cpus`, `--memory` and the same `--memory-swap` (no extra swap),
  `--pids-limit`;
- no published ports, a private IPC namespace, `--init`, `--restart no`;
- `--network none` or the default bridge;
- a 512 MB `tmpfs` at `/tmp`, with `HOME=/tmp/home`;
- one bind mount: the workspace folder at `/workspace`, also the working
  directory;
- labels that record ownership (`dev.open-dots.computer`, `…computer.id`,
  `dev.open-dots.instance`) and a fingerprint of the settings that need a
  recreate (`dev.open-dots.config`);
- the command `sleep infinity`: every tool call is a `docker exec`.

A command runs as `docker exec -u <user> -w /workspace <name> timeout -k 5 <N>
sh -c …`, with the command passed as an argument, never spliced into shell
text. The time limit (default 120 s, at most 30 minutes) is enforced inside the
container, so a runaway process really stops. Output is cut to its first and
last parts (30,000 characters).

### The default image, and choosing another

The app defaults to a desktop with browser tools and Internet enabled. Internet
uses Docker bridge networking and can also reach the host network and LAN; it
is separate from the engine turn egress gate. Blocking a connected app does
not block its website. Signed-in sessions on a bot computer are available to
that bot. Each bot has a distinct container and a browser profile outside the
shared workspace.

Give it a computer is one action. If the desktop image is missing, use
**Build bundled desktop image** in the panel. The owner-only endpoint runs
`docker build --progress=plain -t open-dots-desktop:local desktop-image` with a
fixed repository context, accepts no build arguments, and reports bounded
progress and the actual exit outcome. No turn may start a build. Docker must
be installed and running.

The lower-level shell API default remains `python:3.12-slim-bookworm`, pinned by digest (Debian 12 with
bash, coreutils, Python 3.12 and pip; about 45 MB to download). It has no git
and the agent is not root, so it cannot `apt-get install`. To use another
image:

1. Get it onto this machine yourself (`docker pull …`, or build one), or use
   **Download image** in the Computer panel after choosing it.
2. Set it on the computer: the **Image** field in the Computer panel, or
   `PATCH /api/v1/computers/{id}` with `{"image": "…"}`, then **Recreate**.

Prefer a reference with a digest (`name@sha256:…`): the panel shows
"not pinned" otherwise. The image needs `sh`, `sleep` and `timeout`
(coreutils or BusyBox). For example, a small image with git:

```dockerfile
FROM docker.io/library/python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
```

`docker build -t open-dots-computer:git .` and set the image to
`open-dots-computer:git`.

## How a turn reaches the computer

The Claude or Codex engine runs in the default turn sandbox and starts a
credential-free `app.computers.mailbox` MCP shim. Only a turn-scoped mailbox
is mounted into the sandbox. The shim has no container connection, Docker
configuration, state path or permit path. The backend `ComputerBridge` reads
requests through the same bounded mailbox transport as connected apps.

The normal approval gate records a decision and issues an exact one-use
permit. Before execution the backend checks the live turn ownership, the
exact tool and arguments, the delivered approval, its 15-minute expiry and
unspent state. It consumes the permit and records `consumed_at`, then runs the
existing computer server's validation, takeover, screen lease, freshness and
action-budget checks on the backend. Wrong arguments and replay cannot run.
Docker sockets and computer state are never mounted in a turn; the sandbox
also masks the Docker CLI found on the turn's PATH. No approval/grant tool is
exposed to a model.

Both the filesystem sandbox and its network gate remain enabled. If the
sandbox cannot start, the engine fails with the existing explicit error;
there is no host fallback. With sandboxing explicitly off, the setting's
existing warning applies, and computer calls still use the backend bridge.
The packaged desktop uses `--computer-mailbox` for its child shim.

`api_tools.py` supports the same computer launch and gate while removing host
workspace tools for a computer turn. Engine capability flags remain the
source of truth; the currently unsupported API/local configurations explicitly
say to use Claude or Codex.

### Hand-off

Docker desktop computers expose `request_handoff(reason)`. It requests no
permission to act: a durable Continue/Cancel card pauses the tool at the gate
and emits a `needs_input` notification. The person takes control in the live
Computer panel, signs in or completes a CAPTCHA, QR, passkey or confirmation,
then presses Continue. Continue revokes viewer input across web and Telegram backend processes and
waits for the live view to release its control hold. The tool returns only
that the person finished, never takeover input. A fresh observation is required.
The wait expires after ten minutes with an explicit incomplete message. Cancel
refuses the hand-off and tells the agent not to continue it. Cards use the same
owner checks and one-use decision as other waiting cards. No password store,
vault, automatic password login or Secure Form is supplied.

### Approvals

Every computer call is recorded as an approval and logged. These are answered
without a card, mirroring what the host flow does in each mode:

| Call | ask | accept_edits | plan |
|---|---|---|---|
| `read_file`, `list_files` | allowed (`computer_read`) | allowed | allowed |
| `write_file` | card | allowed (`accept_edits`) | refused (`plan_mode`) |
| `exec` | card, or a saved rule | card, or a saved rule | refused (`plan_mode`) |

A saved command rule matches a computer `exec` exactly as it matches a host
`Bash` command, in the same workspace folder, and **Always allow this command**
on a computer command's card saves the same kind of rule. A command on the
safety floor is never allowed by a rule. There is no "full access" mode.

## Health

`GET /api/v1/computers/health` runs `docker info` with an 8 second limit and
never fails: it reports `available: false` with the reason when the docker
command is missing, the daemon is not running, or Docker does not answer in
time. Every lifecycle step checks it first and answers 503
`docker_unavailable` when Docker is not there; the upkeep job does nothing
while Docker is down.

## API

All routes are local access only, like agents and threads.

| Route | What it does |
|---|---|
| `GET /computers/health` | Docker's state. |
| `GET /computers` | Every computer of this owner. |
| `GET /computers/{id}` | One computer, with `live_state`, `needs_recreate`, `problem`, `health` and `last_command` (`?live=false` skips asking Docker). |
| `GET`, `POST /agents/{id}/computer` | The agent's computer (404 `no_computer`); give it one (201, or 200 with the existing one). `start: true` also makes and starts it. |
| `PATCH /computers/{id}` | `image`, `cpus`, `memory_mb`, `pids_limit`, `network`, `idle_minutes`, `auto_start`. |
| `POST /computers/{id}/prepare-image` | Download the image. |
| `POST /computers/{id}/start`, `/stop`, `/recreate` | Lifecycle. |
| `DELETE /computers/{id}` | Remove it; `{"removed": false}` when Docker is not answering (finished later). |

Agents carry `computer_id` and a `computer` summary; conversations carry the
`computer` their agent has.

## The page

The Agents panel has a **Computer** button per agent: give it a computer
(choosing Local or Cloud in Desktop, and no network or internet for Local), then see its state, image (and whether it is
pinned), limits, mounted folder, idle stop and the last command with its
output; download the image, start, stop, recreate, change limits, network,
image and auto start, or remove it. A conversation whose agent has a computer
shows a **Computer** chip in the header that opens the same view. Cards and
tool steps of computer calls carry a "computer" badge. Against a backend
without computers the button explains that and nothing else changes.

The Cloud option is available only in the local Desktop profile. Its key is
write-only from the UI and remains encrypted on this device. The local backend
sends it to Boat's API over HTTPS for authentication; the key is not included in
agent turns or sent to the cloud computer. Commands and files go to the cloud
computer. Screenshots can be returned to the selected engine when the agent
requests them. No local workspace is mounted into or synced with the cloud
machine. The live desktop view uses a secret provider URL. Chief of Noumenon clears it
from the view when control is handed back, but Boat does not expose a URL
revocation endpoint. Remove all cloud computers before resetting or deleting
the Desktop profile. Boat deletion is accepted asynchronously; Chief of Noumenon keeps
the local computer record and blocks profile reset until Boat reports deletion
complete. The resources may incur charges until removed or archived.

## Testing

- `tests/computers/fake_docker.py` is a stand-in `docker` that keeps its state
  in a file and really runs `docker exec` commands in the mounted folder, so the
  provider, the MCP server, the service, the API and whole turns (with the fake
  Claude CLI calling the real MCP server) are tested end to end.
- `tests/computers/test_real_docker.py` runs against a real daemon when
  `docker info` answers within 10 seconds and the image is already present; it
  never downloads one (`OPEN_DOTS_TEST_IMAGE` picks another local image).

## Not yet

- **An egress allowlist.** Only `none` and `default` exist. A real allowlist
  needs the container on an internal network with a filtering proxy as its
  only way out; a proxy alone could be bypassed, so it is not offered.
- **A remote server over SSH.** The provider interface fits it: the same
  `docker` commands with `-H ssh://<alias>` through the person's own SSH
  config (host key accepted by hand first, connection sharing and short
  timeouts, no ports published on the server). The bind mount would then be a
  folder on the server, not the local workspace.
- Automatic screen queues across conversations. The Computer panel shows when a
  conversation is using the screen. Desktop and browser calls refuse competing
  conversations while the screen lease is active; refused calls are consumed,
  never queued or replayed. Coordinate input after contention, person takeover,
  or another conversation's tracked screen/browser action requires a fresh screenshot before the
  agent decides its next action. A screenshot observed before the change does
  not satisfy that check. Structured browser refs keep their separate freshness
  checks. Real-provider, Docker desktop and installed-app qualification of this
  handoff behavior has not been run.
- Other providers than Claude and Codex: the computer reaches a turn through an
  MCP server, which another provider adapter could mount the same way once it
  can switch off its own host tools (Codex does: see [ENGINES.md](ENGINES.md#codex)).
  The native Mac desktop stays Claude-only.
- Boat cloud computers in the local Desktop app are source-only until the
  provider lifecycle, migrations, agent approval path, Desktop package and a
  real Boat account are qualified. The cloud option is not exposed by the
  hosted web backend. Deletion operations are polled until provider completion.
  The frontend production build passed, but no backend behavior test, live Boat
  check, or packaged-app check was run for this implementation.
