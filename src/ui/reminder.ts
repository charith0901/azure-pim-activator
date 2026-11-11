import * as vscode from "vscode";
import { Profile } from "../core/types";
import { formatLocalTime, formatRemaining } from "../core/time";
import { ProfileStore } from "../profiles/store";

/**
 * Warns once per activation when it is about to expire. Note: PIM won't extend an
 * active role, so "Re-activate" simply runs the normal activation flow.
 */
export function startReminder(
  store: ProfileStore,
  reactivate: (p: Profile) => Promise<void>,
): vscode.Disposable {
  let running = false;

  const check = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const minutes = vscode.workspace.getConfiguration("pim").get<number>("reminderMinutes", 15);
      if (typeof minutes !== "number" || minutes <= 0) return;

      const now = Date.now();
      const horizon = now + minutes * 60_000;
      for (const profile of store.list()) {
        const rec = store.getActivation(profile.name);
        const end = rec?.endDateTime;
        if (!rec || !end) continue;
        const t = Date.parse(end);
        if (Number.isNaN(t) || t <= now || t > horizon) continue;
        if (rec.remindedFor === end) continue;

        await store.setActivation(profile.name, { ...rec, remindedFor: end });
        void vscode.window
          .showWarningMessage(
            `${profile.roleName} (${profile.name}) expires at ${formatLocalTime(end)} (${formatRemaining(end)})`,
            "Re-activate",
          )
          .then(async (choice) => {
            if (choice !== "Re-activate") return;
            try {
              await reactivate(profile);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              void vscode.window.showErrorMessage(`PIM re-activation failed: ${msg}`);
            }
          });
      }
    } catch (err) {
      console.error("PIM reminder check failed", err);
    } finally {
      running = false;
    }
  };

  void check();
  const timer = setInterval(() => void check(), 60_000);
  return new vscode.Disposable(() => clearInterval(timer));
}
