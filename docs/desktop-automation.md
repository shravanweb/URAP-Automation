# Desktop automation (Windows)

Desktop activities drive Windows applications through **Microsoft UI Automation**, the same
accessibility API UiPath uses for modern selectors. They need a Windows worker or a Windows robot.
On other systems every desktop step fails with `DESKTOP_UNSUPPORTED` (HTTP 501) and a message
that says so.

## How it works

```
workflow step ──> desktop adapter (backend/src/automation/desktop/adapter.js)
                     │  validates arguments, keeps the attached window
                     ▼
                  driver.execute(command, payload)
                     │  windows driver (windowsDriver.js): one powershell.exe call per command
                     ▼
                  windows/uia-helper.ps1  (PowerShell 5.1, .NET UIAutomationClient, user32)
```

- **The adapter** is the clean interface. A driver only has to implement `execute(command, payload)`
  for these commands: `open_app`, `attach`, `click`, `type`, `hotkey`, `get_text`, `close`.
- **The Windows driver** starts the helper with
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File uia-helper.ps1 -Payload <base64 JSON>`.
  It reads a single JSON line back and maps helper error codes to platform errors:
  - `ELEMENT_NOT_FOUND` and `WINDOW_NOT_FOUND` are retryable
  - a timeout becomes `DESKTOP_TIMEOUT`
- **No extra install.** No npm native modules and no paid binaries are needed. PowerShell 5.1 and
  .NET Framework ship with Windows 10/11 and Windows Server.
- **`DESKTOP_DRIVER`** selects the driver:
  - `auto` (default): `windows` on Windows, otherwise `none`
  - `windows`
  - `mock`: records calls; for demos and tests on any OS
  - `none`
- `DESKTOP_POWERSHELL` overrides the executable (for example `pwsh.exe`).
  `DESKTOP_COMMAND_TIMEOUT_MS` (default 60000) is added to each step's own timeout.

## Activities

| Activity | Type | Arguments |
| --- | --- | --- |
| Open Application | `desktop_open_app` | `path` (exe or registered app such as `notepad.exe`), `args`, `workingDirectory`, `windowTitle`, `match` (contains, exact, regex), `timeoutMs` |
| Attach Window | `desktop_attach_window` | `title` and/or `processName`, `match`, `timeoutMs` |
| Click (desktop) | `desktop_click` | `selector` or `x`/`y` (window-relative pixels), `button`, `double` |
| Type Into (desktop) | `desktop_type` | `selector` (empty = focused element), `text` or `credentialId`, `method` (`keys` = SendKeys, `value` = UI Automation ValuePattern), `clearBefore` |
| Send Hotkey | `desktop_hotkey` | `keys`: `Ctrl+S`, `Alt+F4`, `Win+R`, `Ctrl+Shift+Esc`, `F5`, `Enter` (modifiers Ctrl, Shift, Alt, Win; named keys; F1–F24; letters and digits) |
| Get Text (desktop) | `desktop_get_text` | `selector` (reads ValuePattern, then TextPattern, then Name) |
| Close Window | `desktop_close_window` | closes the attached window (WindowPattern.Close) |

**Window state.** Open Application and Attach Window remember the window for the rest of the job.
Later steps can also pass `window: { handle }` or `window: { title }`. Without a window the step
fails with `NO_WINDOW`.

**Desktop selectors.** A selector is `{ name, automationId, className, controlType, index }`, and
at least one of the first four is required. Elements are searched in the window's subtree, and
`index` picks the nth match. Find these values with:

- **Accessibility Insights for Windows** (free from Microsoft), or
- `inspect.exe` from the Windows SDK.

**Typing.** `method: keys` sends keystrokes with `System.Windows.Forms.SendKeys`. The characters
`+ ^ % ~ ( ) { } [ ]` are escaped automatically, and newlines become `{ENTER}`. `method: value`
sets the value directly, which is faster and does not depend on focus, but some controls do not
support it.

## Requirements on the Windows machine

- An **interactive, unlocked desktop session**. UI Automation and SendKeys cannot work in a
  locked session, in session 0, or in a service without a desktop.
- **Run where the user is signed in.** Run the worker (`npm run worker`) or the robot agent
  (`npm run robot`) in the signed-in user's session, for example from a terminal or a Task
  Scheduler task set to *Run only when user is logged on*.
- **Same privileges as the target application.** An elevated application (Run as administrator)
  can only be automated from an elevated worker.
- **Unattended use** needs an auto-logon session that stays unlocked. This is the same requirement
  UiPath has for unattended robots.

## What was tested, and what was not

Tested:

- **Unit tests** (`backend/test/automation.unit.test.js`) cover hotkey parsing, SendKeys escaping,
  selector validation, the adapter with a mock driver (open, click, type, hotkey, get text, close,
  and the missing window), driver selection by platform, PowerShell argument building, helper
  output and error mapping, and the Windows driver with a mocked `spawn`.
- **The real `uia-helper.ps1`** is parsed and run with PowerShell 7 (`pwsh`) on Linux, with
  `URAP_UIA_SKIP_ASSEMBLIES=1`. The test checks the `ping` command and the unknown-command error.
  It is skipped if `pwsh` is not installed.

Not tested:

- **No clicks or typing against a real Windows application yet.** The build machine is Linux.
- **First check on Windows:** run a workflow with Open Application `notepad.exe`
  (`windowTitle: "Notepad"`), Type Into (desktop) with `{ "controlType": "Document" }` (on
  Windows 11 Notepad, `{ "controlType": "Edit" }` on Windows 10), then Send Hotkey `Ctrl+A`, then
  Get Text with the same selector.
- **Check the helper on its own** from PowerShell:

```powershell
cd backend\src\automation\desktop\windows
$p = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"command":"ping"}'))
powershell -NoProfile -ExecutionPolicy Bypass -File .\uia-helper.ps1 -Payload $p
```
