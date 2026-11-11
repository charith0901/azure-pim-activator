import * as vscode from "vscode";
import { Profile } from "../core/types";
import { formatLocalTime, formatShortRemaining } from "../core/time";
import { ProfileStore } from "../profiles/store";

function reminderMinutes(): number {
  const v = vscode.workspace.getConfiguration("pim").get<number>("reminderMinutes", 15);
  return typeof v === "number" && v >= 0 ? v : 15;
}

export function createStatusBar(store: ProfileStore): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "pim.activate";

  const update = (): void => {
    const now = Date.now();
    const active = store
      .list()
      .map((p) => ({ p, end: store.getActivation(p.name)?.endDateTime }))
      .filter((x): x is { p: Profile; end: string } => {
        if (!x.end) return false;
        const t = Date.parse(x.end);
        return !Number.isNaN(t) && t > now;
      })
      .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));

    if (active.length === 0) {
      item.text = "$(shield) PIM";
      item.tooltip = "Azure PIM: no active roles. Click to activate.";
      item.backgroundColor = undefined;
    } else {
      const first = active[0];
      let text = `$(shield) ${first.p.roleName} · ${formatShortRemaining(first.end)}`;
      if (active.length > 1) text += ` +${active.length - 1}`;
      item.text = text;

      const minutes = reminderMinutes();
      const msLeft = Date.parse(first.end) - now;
      item.backgroundColor =
        minutes > 0 && msLeft <= minutes * 60_000
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;

      const md = new vscode.MarkdownString();
      md.appendMarkdown("**Active PIM roles**\n\n");
      for (const { p, end } of active) {
        md.appendText(`• ${p.roleName} (${p.name}) until ${formatLocalTime(end)} — ${formatShortRemaining(end)}`);
        md.appendMarkdown("\n\n");
      }
      md.appendMarkdown("_Click to activate a profile._");
      item.tooltip = md;
    }
    item.show();
  };

  update();
  const sub = store.onDidChange(update);
  const cfg = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("pim.reminderMinutes")) update();
  });
  const timer = setInterval(update, 30_000);

  return new vscode.Disposable(() => {
    clearInterval(timer);
    sub.dispose();
    cfg.dispose();
    item.dispose();
  });
}
