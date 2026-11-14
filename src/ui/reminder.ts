import * as vscode from "vscode";
import { Profile } from "../core/types";
import { formatLocalTime, formatRemaining } from "../core/time";
import { ProfileStore } from "../profiles/store";
import { notifyDesktop } from "./desktopNotify";

/** Only announce expiries this recent, so stale records don't fire on startup. */
const EXPIRED_NOTICE_WINDOW_MS = 60 * 60_000;

/**
 * Warns once per activation when it is about to expire, and once when it has expired.
 * Note: PIM won't extend an active role, so "Re-activate" simply runs the normal activation flow.
 */
export function startReminder(
  store: ProfileStore,
  reactivate: (p: Profile) => Promise<void>,
): vscode.Disposable {
  let running = false;

  const offerReactivate = (profile: Profile, choice: string | undefined): void => {
    if (choice !== "Re-activate") return;
    reactivate(profile).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`PIM re-activation failed: ${msg}`);
    });
  };

  const check = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const minutes = vscode.workspace.getConfiguration("pim").get<number>("reminderMinutes", 15);
      const remindersOn = typeof minutes === "number" && minutes > 0;

      const now = Date.now();
      const horizon = now + (remindersOn ? minutes : 0) * 60_000;
      for (const profile of store.list()) {
        const rec = store.getActivation(profile.name);
        const end = rec?.endDateTime;
        if (!rec || !end) continue;
        const t = Date.parse(end);
        if (Number.isNaN(t)) continue;

        if (t <= now) {
          if (now - t > EXPIRED_NOTICE_WINDOW_MS || rec.expiredNotifiedFor === end) continue;
          await store.setActivation(profile.name, { ...rec, expiredNotifiedFor: end });
          const text = `${profile.roleName} (${profile.name}) expired at ${formatLocalTime(end)}`;
          notifyDesktop("PIM role expired", text);
          void vscode.window
            .showInformationMessage(text, "Re-activate")
            .then((choice) => offerReactivate(profile, choice));
          continue;
        }

        if (!remindersOn || t > horizon || rec.remindedFor === end) continue;

        await store.setActivation(profile.name, { ...rec, remindedFor: end });
        const text = `${profile.roleName} (${profile.name}) expires at ${formatLocalTime(end)} (${formatRemaining(end)})`;
        notifyDesktop("PIM role expiring soon", text);
        void vscode.window
          .showWarningMessage(text, "Re-activate")
          .then((choice) => offerReactivate(profile, choice));
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
