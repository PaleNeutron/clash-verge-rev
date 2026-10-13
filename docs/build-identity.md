# Build identity

This fork accepts compile-time environment variables for installed application,
core, service and TUN names. The application and its service client use the same
identity as the service executable and installer. Values are compiled into the
build; changing environment variables after installation does not rename it.

## GitHub Actions

Open **Actions → Custom Identity Build → Run workflow** in this fork. Set
`brand`, optionally set `app_name`, and select a platform or `all`. Additional
variables go in the `overrides` JSON input, for example:

```json
{
  "CVR_APP_NAME": "Aurora Network",
  "CVR_WINDOWS_SERVICE_NAME": "aurora_agent",
  "CVR_SERVICE_DISPLAY_NAME": "Aurora Agent",
  "CVR_TUN_DEVICE": "aurora0",
  "CVR_TUN_DEVICE_MACOS": "utun2048"
}
```

Each platform uploads installers, the resolved `identity.json`, and installed
runtime evidence in `identity-verification.json`. Builds use the pinned service
fork source and do not require the upstream project's signing secrets.
Set `app_log_level=debug` to capture application startup diagnostics during
verification; service driver output remains unchanged.
Enable `compare_defaults` to also build and verify the unconfigured identity.
The comparison jobs omit updater signing artifacts so they can run without
upstream private signing keys; normal local build defaults retain those artifacts.

For verification-only changes, `reuse_run` can reference an earlier run in this
fork that originally produced the installers; chained reuse is rejected. The
workflow requires the same resolved identity and rejects changes to
application, dependency, installer or build source since that run. It then checks
the existing installers with the current verifier, recording both revisions.
A change to build inputs requires a new build.

## Local build

Install the prerequisites in [CONTRIBUTING.md](../CONTRIBUTING.md), then run:

```sh
pnpm install --frozen-lockfile
CVR_BRAND=aurora CVR_APP_NAME="Aurora Network" pnpm build
```

In PowerShell:

```powershell
$env:CVR_BRAND = "aurora"
$env:CVR_APP_NAME = "Aurora Network"
pnpm build
```

Use `pnpm build` or `pnpm build:fast` to prepare the identity before invoking
Tauri. Custom builds automatically download the cores and compile the service
tools from the same pinned revision as the client library. `pnpm prebuild`
also honors the variables when preparing resources independently. Ordinary
unconfigured builds retain the upstream prebuild/build workflow.

`node scripts/build.mjs --prepare-only --target x86_64-pc-windows-msvc` writes
the resolved configuration and installer templates under
`src-tauri/gen/build-identity/` without downloading or compiling binaries.
Original installer templates remain unchanged. The normal Tauri target and
feature options, including `-t`, `-f`, and `--features=verge-dev`, are supported.

## Variables

`CVR_BRAND` is a lowercase slug of up to 15 characters. It derives a consistent
identity; explicit variables override its defaults. For `CVR_BRAND=aurora`:

| Variable | Derived value | Purpose |
| --- | --- | --- |
| `CVR_APP_NAME` | `Aurora` | Application title, installation folder, package display name |
| `CVR_APP_BINARY` | `aurora` | Main executable, startup metadata, default HTTP user agent |
| `CVR_APP_ID` | `io.github.paleneutron.aurora` | Bundle identity and application data directory |
| `CVR_CORE_NAME` | `aurora-core` | Stable core executable in sidecar and service mode |
| `CVR_CORE_ALPHA_NAME` | `aurora-core-alpha` | Alpha core executable in sidecar and service mode |
| `CVR_SERVICE_BINARY` | `aurora-service` | Service executable; helpers append `-install` and `-uninstall` |
| `CVR_SERVICE_SLUG` | `aurora-service` | Linux service unit and persistent service directories |
| `CVR_WINDOWS_SERVICE_NAME` | `aurora_service` | Windows registered service name |
| `CVR_SERVICE_DISPLAY_NAME` | `Aurora Service` | Registered service display name |
| `CVR_MACOS_SERVICE_ID` | `io.github.paleneutron.aurora.service` | macOS helper and LaunchDaemon identity |
| `CVR_BACKUP_DIR` | `aurora-backup` | Backup directory name |
| `CVR_URL_SCHEME` | `aurora` | Registered URL import scheme |
| `CVR_TUN_DEVICE` | `aurora` | Windows/Linux TUN default |
| `CVR_TUN_DEVICE_MACOS` | `utun1024` | macOS TUN default |
| `CVR_CORE_IPC_NAME` | `aurora-core` | Core socket and named-pipe base |
| `CVR_OWNER_TOKEN_FILE` | `.aurora-service-owner-token` | Windows service authentication token filename |
| `CVR_CORE_LOCK_NAME` | `aurora-service.core-execution` | Core execution lock namespace |

Without a brand or changed overrides, names retain upstream defaults. With a
changed identity, `CVR_CUSTOM_BUILD=1` is derived automatically and propagated
to Rust and frontend compilation. Upstream application update checks and
installation are disabled so updates cannot overwrite a customized build.
Core upgrades retain the configured physical filenames.

Stable/alpha core selection identifiers in saved settings remain compatible
with upstream; physical executable names are mapped at launch, validation,
staging and upgrade boundaries. New TUN configurations and the GUI reset action
use the compiled default. An explicitly saved TUN device choice remains in use.

## Naming constraints

Executable names are stems without a platform extension. Use letters, digits,
hyphens, underscores or periods, start with a letter, and keep them within
64 characters. Main, stable, alpha, service and helper stems must be distinct
even on case-insensitive filesystems. Core stems cannot end in `.next` or
`.old`, which are reserved for incomplete or displaced executables.

Display names allow Unicode letters and digits, spaces, underscores, periods,
parentheses and hyphens, up to 80 characters, with no trailing space or period.
Bundle identifiers use dot-separated alphanumeric/hyphen components beginning
with a letter. URL schemes start with a lowercase letter.

Windows/Linux TUN names contain at most 15 characters. macOS TUN names must be
`utun` followed by digits, as required by [Mihomo's TUN interface](https://wiki.metacubex.one/en/config/inbound/tun/).
Service slugs are at most 32 characters and core IPC names at most 24;
`CVR_APP_ID` and `CVR_CORE_IPC_NAME` together are at most 64 characters to leave
room for Unix socket paths. An unusually long HOME/XDG or macOS temporary path
can still exceed the operating system's socket-path limit.

Development-channel builds append `.dev` to the application identity and
`-dev`/`_dev` to service identities, and use separate data and service state.
The execution lock stays shared between development and release builds of the
same identity, preserving the existing core exclusivity policy.

Application icons and legal attribution remain upstream assets. Engine
protocols, configuration formats and license notices continue to identify their
original projects; this feature configures installed identity and does not
promise that inspecting software or network traffic cannot identify the engine.

## Installed verification

The Actions job installs the produced package and checks executable names,
registered service metadata, client/service IPC, stable and alpha core processes,
TUN interfaces, installed launcher names and targets, the main application
process and removal of the installed service/application. It does not route runner traffic through TUN during these
checks. The evidence artifact records each completed check, any failure, installer
provenance and application runtime logs from the fresh runner. A separate
`identity-diagnostics-*` artifact provides the same evidence without downloading
the installers.

macOS shutdown checks send SIGTERM to the recorded installed application PID,
which invokes its normal configuration-save, core-stop and DNS-restore cleanup.
Ordinary shutdown requires an exit code of zero and both cores to stop before
service removal. An existing HTTP-plugin/WebKit deadlock affected native final
process exit after both Cocoa Quit and SIGTERM on hosted runners. If this
launch's logs confirm successful cleanup, both cores are absent, and a stack
sample matches that captured deadlock, the verifier cleans up only the revalidated
owned stranded PID and records native shutdown as unverified. Unknown hangs
remain failures. Cocoa application Quit and the Quit menu are not verified;
this conditional process cleanup does not claim that Quit is fixed.

Headless Linux/Xvfb verification uses the ordinary `theme_mode: light` setting
instead of desktop theme-portal discovery. The verifier first generates the
application's compiled default settings, confirms that initialization left no
application or core running, and changes only that field. It refuses to overwrite
pre-existing settings and records this headless condition in the evidence.
These checks do not verify default system-theme startup in a real desktop session.

Scheduled task, LaunchAgent and XDG autostart creation/removal require toggling
the setting in the running application. This workflow does not automate that
GUI interaction, and prewriting the saved preference does not register the entry
on launch. The evidence records this runtime verification limitation; installed
launchers are checked separately.

Run the build-contract regressions with `pnpm test:identity`. Frontend identity
regressions run with the normal `pnpm test` command. Both default and customized
service-source test suites also exercise channel and core identity propagation.
