// Native OS desktop notifications, shown only when the VS Code window is not focused.

import * as vscode from "vscode";
import { execFile } from "child_process";

const TIMEOUT_MS = 10_000;

/** PowerShell's AppUserModelID; always registered, so Windows will display the toast. */
const WINDOWS_AUMID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

// Text arrives via env vars so nothing user-controlled is ever interpolated into the script.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$title = [Security.SecurityElement]::Escape($env:PIM_TOAST_TITLE)
$body = [Security.SecurityElement]::Escape($env:PIM_TOAST_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WINDOWS_AUMID}').Show($toast)
`;

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFile(file, args, { timeout: TIMEOUT_MS, windowsHide: true, env }, (err) => {
    if (!err) return;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // notifier not installed
    console.warn(`PIM: desktop notification failed: ${err.message}`);
  });
}

/** Fire-and-forget OS toast. Never throws. No-op while VS Code is focused or when disabled. */
export function notifyDesktop(title: string, body: string): void {
  try {
    if (vscode.window.state.focused) return;
    if (!vscode.workspace.getConfiguration("pim").get<boolean>("desktopNotifications", true)) return;

    switch (process.platform) {
      case "win32": {
        const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
        run(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
          { ...process.env, PIM_TOAST_TITLE: title, PIM_TOAST_BODY: body },
        );
        break;
      }
      case "darwin":
        run("osascript", [
          "-e",
          "on run argv",
          "-e",
          "display notification (item 2 of argv) with title (item 1 of argv)",
          "-e",
          "end run",
          title,
          body,
        ]);
        break;
      default:
        run("notify-send", ["--app-name=Azure PIM", title, body]);
    }
  } catch (err) {
    console.warn("PIM: desktop notification failed", err);
  }
}
