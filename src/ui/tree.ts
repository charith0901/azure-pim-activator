import * as vscode from "vscode";
import { Profile } from "../core/types";
import { formatAgo, formatLocalTime, formatShortRemaining } from "../core/time";
import { ProfileStore } from "../profiles/store";
import { activationHoursFor, formatHours } from "./duration";

export class ProfilesTreeProvider implements vscode.TreeDataProvider<Profile>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Profile | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<Profile | undefined | void> = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly store: ProfileStore) {
    this.disposables.push(store.onDidChange(() => this.refresh()));
    this.timer = setInterval(() => this.refresh(), 60_000);
  }

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(element?: Profile): Profile[] {
    return element ? [] : this.store.list();
  }

  getTreeItem(p: Profile): vscode.TreeItem {
    const active = this.store.isActive(p.name);
    const end = this.store.getActivation(p.name)?.endDateTime;

    const item = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.None);
    item.id = p.name;
    item.description = active
      ? `${p.roleName} · active · ${formatShortRemaining(end)}`
      : `${p.roleName} · ${p.scopeName || p.resourceGroup || p.scope}`;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${escapeMd(p.name)}**\n\n`);
    md.appendMarkdown(`- **Role:** ${escapeMd(p.roleName)}\n`);
    md.appendMarkdown(`- **Scope:** ${escapeMd(p.scopeName || p.scope)} (\`${p.scope}\`)\n`);
    if (p.resourceGroup) {
      md.appendMarkdown(`- **Resource group:** ${escapeMd(p.resourceGroup)}\n`);
    }
    if (p.subscriptionId) {
      md.appendMarkdown(
        `- **Subscription:** ${escapeMd(p.subscriptionName || p.subscriptionId)} (\`${p.subscriptionId}\`)\n`,
      );
    }
    md.appendMarkdown(`- **Tenant:** ${escapeMd(p.tenantName || p.tenantId)} (\`${p.tenantId}\`)\n`);
    md.appendMarkdown(
      `- **Activation length:** ${formatHours(activationHoursFor(p))}${p.activationHours === undefined ? " (default)" : ""}
`,
    );
    md.appendMarkdown(`- **Last used:** ${p.lastUsedAt ? formatAgo(p.lastUsedAt) : "never"}\n`);
    if (active) {
      md.appendMarkdown(`- **Active until:** ${formatLocalTime(end)} (${formatShortRemaining(end)} left)\n`);
    }
    item.tooltip = md;

    item.iconPath = active
      ? new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"))
      : new vscode.ThemeIcon("shield");
    item.contextValue = active ? "profile.active" : "profile";
    return item;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}

function escapeMd(s: string): string {
  return (s ?? "").replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
