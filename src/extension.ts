import * as vscode from "vscode";
import { Profile } from "./core/types";
import { formatAgo } from "./core/time";
import { ProfileStore } from "./profiles/store";
import { ProfilesTreeProvider } from "./ui/tree";
import { createStatusBar } from "./ui/statusBar";
import { startReminder } from "./ui/reminder";
import { runNewProfileWizard } from "./ui/wizard";
import { activateProfile, refreshActivations } from "./ui/activate";
import { formatHours, pickActivationHours } from "./ui/duration";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

async function pickProfile(store: ProfileStore, placeHolder: string): Promise<Profile | undefined> {
  const profiles = store.list();

  if (profiles.length === 0) {
    const choice = await vscode.window.showInformationMessage("No PIM profiles yet.", "New profile");
    if (choice) {
      await vscode.commands.executeCommand("pim.newProfile");
    }
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => ({
      label: p.name,
      description: `${p.roleName} · ${p.scopeName || p.resourceGroup || p.scope}`,
      detail: [
        p.subscriptionName || p.subscriptionId,
        store.isActive(p.name) ? "active" : `last used ${formatAgo(p.lastUsedAt)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      profile: p,
    })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true },
  );

  return picked?.profile;
}

// Tree inline buttons pass the Profile; the command palette passes nothing.
function asProfile(arg: unknown): Profile | undefined {
  return arg && typeof arg === "object" && "name" in arg && "scope" in arg ? (arg as Profile) : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new ProfileStore(context.globalState);
  const tree = new ProfilesTreeProvider(store);

  const refresh = () =>
    refreshActivations(store).catch((err) => console.warn("PIM refresh failed", err));

  context.subscriptions.push(
    store,
    tree,
    vscode.window.registerTreeDataProvider("pimProfiles", tree),
    createStatusBar(store),
    startReminder(store, (p) => activateProfile(store, p)),

    vscode.commands.registerCommand("pim.activate", async (arg?: unknown) => {
      const profile = asProfile(arg) ?? (await pickProfile(store, "Select a profile to activate"));
      if (profile) {
        await activateProfile(store, profile);
      }
    }),

    vscode.commands.registerCommand("pim.newProfile", () => runNewProfileWizard(store)),

    vscode.commands.registerCommand("pim.deleteProfile", async (arg?: unknown) => {
      const profile = asProfile(arg) ?? (await pickProfile(store, "Select a profile to delete"));
      if (!profile) return;

      const answer = await vscode.window.showWarningMessage(
        `Delete PIM profile "${profile.name}"?`,
        { modal: true },
        "Delete",
      );

      if (answer === "Delete") {
        await store.delete(profile.name);
      }
    }),

    vscode.commands.registerCommand("pim.setActivationLength", async (arg?: unknown) => {
      const picked = asProfile(arg) ?? (await pickProfile(store, "Select a profile to change"));
      // Re-read so we don't overwrite fields changed since the tree item was rendered.
      const profile = picked && (store.get(picked.name) ?? picked);
      if (!profile) return;

      const hours = await pickActivationHours(profile);
      if (hours === undefined) return;

      const { activationHours: _old, ...rest } = profile;
      await store.save(hours === null ? rest : { ...rest, activationHours: hours });
      void vscode.window.showInformationMessage(
        hours === null
          ? `"${profile.name}" now uses the default activation length.`
          : `"${profile.name}" will activate for ${formatHours(hours)}.`,
      );
    }),

    vscode.commands.registerCommand("pim.refresh", () =>
      vscode.window.withProgress(
        { location: { viewId: "pimProfiles" }, title: "Refreshing PIM activations" },
        refresh,
      ),
    ),
  );

  // Pick up activations made elsewhere (portal, CLI) without prompting for sign-in.
  void refresh();
  const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {}
