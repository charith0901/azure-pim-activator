// Multi-step "New profile" wizard: Tenant -> eligible role (tenant-wide) -> name.
// Eligibilities are listed at the provider level, so no RBAC on subscriptions/resource groups is needed.
// One QuickPick is reused for the list steps; the name step uses an InputBox.
// Back goes to the previous step (cached lists are kept); Esc cancels the whole wizard.

import * as vscode from "vscode";
import { getArmToken, decodeClaims } from "../core/auth";
import { listTenants, listSubscriptions, listMyEligibilities } from "../core/arm";
import { describeError } from "../core/errors";
import { formatLocalTime } from "../core/time";
import { ProfileStore } from "../profiles/store";
import { activateProfile } from "./activate";
import { ACTIVATION_DURATION, Eligibility, Profile, Tenant } from "../core/types";

const TOTAL_STEPS = 3;
const BASE_TITLE = "Azure PIM: New profile";

type StepResult<T> = { kind: "pick"; value: T } | { kind: "back" } | { kind: "cancel" };
type ValueItem<T> = vscode.QuickPickItem & { value: T };

interface PickStepOptions<T> {
  title: string;
  step: number;
  placeholder: string;
  emptyPlaceholder: string;
  load: () => Promise<T[]>;
  toItem: (value: T) => vscode.QuickPickItem;
  isSelected?: (value: T) => boolean;
  onEmpty?: () => void;
}

/** Shows one list step on the shared QuickPick. Rejects if loading fails. */
function pickStep<T>(qp: vscode.QuickPick<ValueItem<T>>, opts: PickStepOptions<T>): Promise<StepResult<T>> {
  return new Promise<StepResult<T>>((resolve, reject) => {
    const disposables: vscode.Disposable[] = [];
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      disposables.forEach((d) => d.dispose());
      fn();
    };

    qp.title = opts.title;
    qp.step = opts.step;
    qp.totalSteps = TOTAL_STEPS;
    qp.buttons = opts.step > 1 ? [vscode.QuickInputButtons.Back] : [];
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.ignoreFocusOut = false;
    qp.value = "";
    qp.items = [];
    qp.busy = true;
    qp.enabled = true;
    qp.placeholder = "Loading…";

    disposables.push(
      qp.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) finish(() => resolve({ kind: "back" }));
      }),
      qp.onDidAccept(() => {
        const item = qp.selectedItems[0] ?? qp.activeItems[0];
        if (!item || qp.busy) return;
        finish(() => resolve({ kind: "pick", value: item.value }));
      }),
      qp.onDidHide(() => finish(() => resolve({ kind: "cancel" }))),
    );

    qp.show();

    opts.load().then(
      (values) => {
        if (settled) return;
        const items: ValueItem<T>[] = values.map((value) => ({ ...opts.toItem(value), value }));
        qp.items = items;
        qp.busy = false;
        if (items.length === 0) {
          qp.placeholder = opts.emptyPlaceholder;
          opts.onEmpty?.();
          return;
        }
        qp.placeholder = opts.placeholder;
        const selected = opts.isSelected ? items.find((i) => opts.isSelected!(i.value)) : undefined;
        if (selected) qp.activeItems = [selected];
      },
      (err) => finish(() => reject(err)),
    );
  });
}

interface NameStepOptions {
  title: string;
  step: number;
  value: string;
}

/** Shows the profile-name input box. */
function nameStep(opts: NameStepOptions): Promise<StepResult<string>> {
  return new Promise<StepResult<string>>((resolve) => {
    const box = vscode.window.createInputBox();
    const disposables: vscode.Disposable[] = [box];
    let settled = false;
    const finish = (result: StepResult<string>): void => {
      if (settled) return;
      settled = true;
      disposables.forEach((d) => d.dispose());
      resolve(result);
    };
    const validate = (value: string): string | undefined => (value.trim() ? undefined : "Name is required");

    box.title = opts.title;
    box.step = opts.step;
    box.totalSteps = TOTAL_STEPS;
    box.buttons = [vscode.QuickInputButtons.Back];
    box.prompt = "Profile name";
    box.placeholder = "Profile name";
    box.value = opts.value;
    box.valueSelection = [0, opts.value.length];

    disposables.push(
      box.onDidChangeValue((v) => {
        box.validationMessage = validate(v);
      }),
      box.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) finish({ kind: "back" });
      }),
      box.onDidAccept(() => {
        const message = validate(box.value);
        if (message) {
          box.validationMessage = message;
          return;
        }
        finish({ kind: "pick", value: box.value.trim() });
      }),
      box.onDidHide(() => finish({ kind: "cancel" })),
    );

    box.show();
  });
}

function breadcrumb(parts: Array<string | undefined>): string {
  const trail = parts.filter((p): p is string => Boolean(p));
  return trail.length ? `${BASE_TITLE} — ${trail.join(" › ")}` : BASE_TITLE;
}

const SCOPE_TYPE_LABELS: Record<string, string> = {
  resourcegroup: "resource group",
  subscription: "subscription",
  managementgroup: "management group",
  resource: "resource",
};

function describeScope(e: Eligibility): string {
  const name = e.scopeName || e.scope;
  const type = e.scopeType ? SCOPE_TYPE_LABELS[e.scopeType.toLowerCase()] || e.scopeType : undefined;
  return type ? `${name} · ${type}` : name;
}

interface TenantSession {
  token: string;
  oid: string;
}

interface WizardState {
  tenant?: Tenant;
  eligibility?: Eligibility;
  name?: string;
  // Caches keyed by tenant so in-flight loads for an abandoned choice can't pollute state.
  tenants?: Tenant[];
  sessions: Map<string, TenantSession>;
  eligibilities: Map<string, Eligibility[]>;
}

async function sessionFor(state: WizardState, tenantId: string): Promise<TenantSession> {
  const cached = state.sessions.get(tenantId);
  if (cached) return cached;
  const token = (await getArmToken(tenantId))!;
  const { oid } = decodeClaims(token);
  if (!oid) {
    throw new Error("Could not read your object ID (oid) from the access token.");
  }
  const session = { token, oid };
  state.sessions.set(tenantId, session);
  return session;
}

/** Best-effort subscription display name; listing subscriptions needs RBAC the user may not have. */
async function subscriptionNameFor(token: string, tenantId: string, subscriptionId: string): Promise<string> {
  if (!subscriptionId) return "";
  try {
    const subs = await listSubscriptions(token, tenantId);
    const wanted = subscriptionId.toLowerCase();
    return subs.find((s) => s.subscriptionId.toLowerCase() === wanted)?.displayName || subscriptionId;
  } catch {
    return subscriptionId;
  }
}

/** Runs the wizard; returns the saved profile, or undefined if cancelled or failed. */
export async function runNewProfileWizard(store: ProfileStore): Promise<Profile | undefined> {
  const state: WizardState = {
    sessions: new Map(),
    eligibilities: new Map(),
  };
  // One QuickPick reused across list steps; typed loosely since each step carries a different value type.
  const qp = vscode.window.createQuickPick<ValueItem<any>>();

  try {
    let step = 0;
    while (step < TOTAL_STEPS) {
      let result: StepResult<unknown>;

      switch (step) {
        case 0: {
          const r = await pickStep<Tenant>(qp, {
            title: breadcrumb([]),
            step: 1,
            placeholder: "Select tenant",
            emptyPlaceholder: "Your account has no accessible Azure tenants. Press Esc to cancel.",
            load: async () => {
              if (!state.tenants) {
                const homeToken = (await getArmToken())!;
                state.tenants = await listTenants(homeToken);
              }
              return state.tenants;
            },
            toItem: (t) => ({ label: t.displayName, description: t.defaultDomain }),
            isSelected: (t) => t.tenantId === state.tenant?.tenantId,
          });
          if (r.kind === "pick" && r.value.tenantId !== state.tenant?.tenantId) {
            state.tenant = r.value;
            state.eligibility = undefined;
            state.name = undefined;
          }
          result = r;
          break;
        }

        case 1: {
          const tenant = state.tenant!;
          const r = await pickStep<Eligibility>(qp, {
            title: breadcrumb([tenant.displayName]),
            step: 2,
            placeholder: "Select eligible role",
            emptyPlaceholder: `No eligible PIM roles for you in ${tenant.displayName}. Go back to choose another tenant.`,
            load: async () => {
              let list = state.eligibilities.get(tenant.tenantId);
              if (!list) {
                const { token } = await sessionFor(state, tenant.tenantId);
                list = await listMyEligibilities(token);
                state.eligibilities.set(tenant.tenantId, list);
              }
              return list;
            },
            toItem: (e) => ({
              label: e.roleName,
              description: describeScope(e),
              detail: e.endDateTime ? `eligible until ${formatLocalTime(e.endDateTime)}` : "permanent",
            }),
            isSelected: (e) => e === state.eligibility,
            onEmpty: () => {
              void vscode.window.showWarningMessage(`No eligible PIM roles for you in ${tenant.displayName}.`);
            },
          });
          if (r.kind === "pick" && r.value !== state.eligibility) {
            state.eligibility = r.value;
            state.name = undefined; // re-derive the default name from the new choice
          }
          result = r;
          break;
        }

        default: {
          const eligibility = state.eligibility!;
          const scopeLabel = eligibility.scopeName || eligibility.resourceGroup || eligibility.scope;
          const r = await nameStep({
            title: breadcrumb([state.tenant!.displayName, scopeLabel]),
            step: 3,
            value: state.name ?? `${scopeLabel} ${eligibility.roleName}`,
          });
          if (r.kind === "pick") {
            state.name = r.value;
            const lower = r.value.toLowerCase();
            const exists = store.list().some((p) => p.name.toLowerCase() === lower);
            if (exists) {
              const choice = await vscode.window.showWarningMessage(
                `A profile named "${r.value}" already exists. Overwrite?`,
                { modal: true },
                "Overwrite",
              );
              if (choice !== "Overwrite") continue; // stay on the name step
            }
          }
          result = r;
          break;
        }
      }

      if (result.kind === "cancel") return undefined;
      if (result.kind === "back") {
        if (step === 0) return undefined;
        step -= 1;
      } else {
        step += 1;
      }
    }

    qp.hide();

    const { tenant, eligibility, name } = state;
    const session = await sessionFor(state, tenant!.tenantId);
    const subscriptionId = eligibility!.subscriptionId ?? "";

    const profile = await store.save({
      name: name!,
      tenantId: tenant!.tenantId,
      tenantName: tenant!.displayName,
      subscriptionId,
      subscriptionName: await subscriptionNameFor(session.token, tenant!.tenantId, subscriptionId),
      resourceGroup: eligibility!.resourceGroup ?? "",
      // Activation must target the scope the eligibility was granted on.
      scope: eligibility!.scope,
      scopeName: eligibility!.scopeName,
      principalId: session.oid,
      roleDefinitionId: eligibility!.roleDefinitionId,
      roleName: eligibility!.roleName,
      activationDuration: ACTIVATION_DURATION,
    });

    // Don't block the wizard's result on a notification the user may never dismiss.
    void vscode.window
      .showInformationMessage(`Saved profile "${profile.name}"`, "Activate now")
      .then((choice) => {
        if (choice === "Activate now") return activateProfile(store, profile);
        return undefined;
      });

    return profile;
  } catch (err) {
    void vscode.window.showErrorMessage(describeError(err));
    return undefined;
  } finally {
    qp.dispose();
  }
}
