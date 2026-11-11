// Activation length: global default setting, per-profile override, and the picker UI.

import * as vscode from "vscode";
import { DEFAULT_ACTIVATION_HOURS, MAX_ACTIVATION_HOURS, MIN_ACTIVATION_HOURS, Profile } from "../core/types";

function clampHours(h: number): number {
  return Math.min(MAX_ACTIVATION_HOURS, Math.max(MIN_ACTIVATION_HOURS, h));
}

/** The `pim.activationHours` setting, clamped to what PIM accepts. */
export function defaultActivationHours(): number {
  const v = vscode.workspace.getConfiguration("pim").get<number>("activationHours");
  return typeof v === "number" && Number.isFinite(v) ? clampHours(v) : DEFAULT_ACTIVATION_HOURS;
}

/** The profile's own length if set, otherwise the global default. */
export function activationHoursFor(p: Profile): number {
  return typeof p.activationHours === "number" && Number.isFinite(p.activationHours)
    ? clampHours(p.activationHours)
    : defaultActivationHours();
}

/** 8 -> "8h", 1.5 -> "1h 30m", 0.5 -> "30m" */
export function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Accepts "4", "1.5", "4h", "90m", "1h 30m". Returns hours, or undefined if unparseable. */
export function parseHours(text: string): number | undefined {
  const s = text.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return undefined;
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
}

type Choice = vscode.QuickPickItem & { hours?: number | null };

/**
 * Asks for a profile's activation length.
 * Resolves to a number of hours, `null` for "use the default", or `undefined` if cancelled.
 */
export async function pickActivationHours(profile: Profile): Promise<number | null | undefined> {
  const def = defaultActivationHours();
  const current = profile.activationHours;
  const presets = [1, 2, 4, 8, 12, 24];

  const items: Choice[] = [
    {
      label: `Use default (${formatHours(def)})`,
      description: current === undefined ? "current" : undefined,
      detail: "Follows the pim.activationHours setting",
      hours: null,
    },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    ...presets.map<Choice>((h) => ({
      label: formatHours(h),
      description: current === h ? "current" : undefined,
      hours: h,
    })),
    { label: "Custom…", detail: `Between ${formatHours(MIN_ACTIVATION_HOURS)} and ${formatHours(MAX_ACTIVATION_HOURS)}` },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: `Activation length for "${profile.name}"`,
    placeHolder: "Azure rejects lengths above the role's PIM policy maximum",
  });
  if (!picked) return undefined;
  if (picked.hours !== undefined) return picked.hours;

  const text = await vscode.window.showInputBox({
    title: `Activation length for "${profile.name}"`,
    prompt: "Hours, e.g. 3, 1.5, 90m or 2h 30m",
    value: current !== undefined && !presets.includes(current) ? formatHours(current) : "",
    validateInput: (v) => {
      const h = parseHours(v);
      if (h === undefined) return "Enter a length like 3, 1.5, 90m or 2h 30m";
      if (h < MIN_ACTIVATION_HOURS || h > MAX_ACTIVATION_HOURS) {
        return `Must be between ${formatHours(MIN_ACTIVATION_HOURS)} and ${formatHours(MAX_ACTIVATION_HOURS)}`;
      }
      return undefined;
    },
  });
  if (text === undefined) return undefined;
  return parseHours(text);
}
