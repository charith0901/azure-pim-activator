// Activation flow for a saved profile, plus background refresh of known activations.

import * as vscode from "vscode";
import { getArmToken, decodeClaims } from "../core/auth";
import {
  FAILED_STATUSES,
  findEligibleAssignments,
  findActiveInstance,
  findActiveForProfile,
  createSelfActivationRequest,
} from "../core/pim";
import { AzureRequestError, describeError } from "../core/errors";
import { formatLocalTime, formatRemaining } from "../core/time";
import { ProfileStore } from "../profiles/store";
import { ArmScheduleInstance, PimConfig, Profile, profileToConfig } from "../core/types";
import { activationHoursFor, formatHours } from "./duration";
import { notifyDesktop } from "./desktopNotify";

/** Profiles (lower-cased names) with an activation currently in flight. */
const inFlight = new Set<string>();

function sameId(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** Delay before re-reading Azure to reconcile a freshly activated role's end time. */
const RECONCILE_DELAY_MS = 30_000;

async function chooseAssignment(
  assignments: ArmScheduleInstance[],
  config: PimConfig,
): Promise<ArmScheduleInstance | undefined> {
  type Item = vscode.QuickPickItem & { assignment: ArmScheduleInstance };
  const items: Item[] = assignments.map((a) => {
    const exp = a.properties.expandedProperties;
    const end = a.properties.endDateTime;
    return {
      label: exp?.roleDefinition?.displayName || config.roleName || "Unknown",
      description: exp?.scope?.displayName || a.properties.scope,
      detail: end ? `eligible until ${formatLocalTime(end)}` : "permanent",
      assignment: a,
    };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: `Multiple ${config.roleName} eligibilities found`,
    placeHolder: "Select the eligibility to activate",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.assignment;
}

/** Activates the profile's role. Never throws; reports outcome via notifications. */
export async function activateProfile(store: ProfileStore, profile: Profile): Promise<void> {
  const key = profile.name.toLowerCase();
  if (inFlight.has(key)) {
    void vscode.window.showInformationMessage(`An activation for "${profile.name}" is already in progress.`);
    return;
  }
  inFlight.add(key);
  const hours = activationHoursFor(profile);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Activating ${profile.roleName} (${profile.name}) for ${formatHours(hours)}`,
        cancellable: true,
      },
      async (progress, cancel) => {
        const config = profileToConfig(profile, hours);

        progress.report({ message: `Signing in to ${profile.tenantName || profile.tenantId}…` });
        const token = (await getArmToken(profile.tenantId))!;

        const claims = decodeClaims(token);
        if (claims.oid && !sameId(claims.oid, config.principalId)) {
          void vscode.window.showWarningMessage(
            `Profile "${profile.name}" was created for a different account (${config.principalId}). Using the signed-in account instead.`,
          );
          config.principalId = claims.oid;
        }

        progress.report({ message: "Finding eligibility…" });
        const assignments = await findEligibleAssignments(config, token);
        if (assignments.length === 0) {
          void vscode.window.showErrorMessage(
            `PIM: No active ${config.roleName} eligibility on ${config.scope.split("/").pop()}. ` +
              "It may have expired or been removed. Recreate the profile.",
          );
          return;
        }

        let assignment: ArmScheduleInstance | undefined = assignments[0];
        if (assignments.length > 1) {
          assignment = await chooseAssignment(assignments, config);
        }
        if (!assignment || cancel.isCancellationRequested) return;

        await store.touch(profile.name);

        progress.report({ message: "Checking current activation…" });
        const eligibilityScheduleId = assignment.properties.roleEligibilityScheduleId!;
        const active = await findActiveInstance(config, token, eligibilityScheduleId);
        if (active) {
          const end = active.properties.endDateTime;
          await store.setActivation(profile.name, { endDateTime: end });
          void vscode.window.showInformationMessage(
            `${config.roleName} is already active until ${formatLocalTime(end)} (${formatRemaining(end)})`,
          );
          return;
        }
        if (cancel.isCancellationRequested) return;

        progress.report({ message: "Submitting request…" });
        const result = await createSelfActivationRequest(config, token, assignment.name);

        if (result.status === "PendingApproval") {
          void vscode.window.showWarningMessage(
            `${config.roleName} needs approval. It will activate once an approver accepts the request.`,
          );
          return;
        }
        if (FAILED_STATUSES.includes(result.status)) {
          throw new Error(
            `Role Assignment Schedule Request finished with status "${result.status}" (request ID: ${result.requestId}).`,
          );
        }

        // The role is usable as soon as Azure accepts the request; no need to poll for it.
        const end = result.endDateTime;
        await store.setActivation(profile.name, { endDateTime: end });
        const okText = `${config.roleName} (${profile.name}) activated until ${formatLocalTime(end)} (${formatRemaining(end)} left)`;
        notifyDesktop("PIM role activated", okText);
        void vscode.window.showInformationMessage(`✔ ${okText}`);
        // Reconcile the stored end time with Azure's actual instance shortly after.
        setTimeout(() => void reconcileActivation(store, profile.name, config, token), RECONCILE_DELAY_MS);
      },
    );
  } catch (err) {
    if (isDurationTooLong(err)) {
      const text = `${formatHours(hours)} is longer than the ${profile.roleName} policy allows. Choose a shorter activation length.`;
      notifyDesktop(`PIM activation failed: ${profile.name}`, text);
      const choice = await vscode.window.showErrorMessage(`PIM: ${text}`, "Set activation length");
      if (choice) await vscode.commands.executeCommand("pim.setActivationLength", profile);
    } else {
      const text = describeError(err);
      notifyDesktop(`PIM activation failed: ${profile.name}`, text);
      void vscode.window.showErrorMessage(`PIM: ${text}`);
    }
  } finally {
    inFlight.delete(key);
  }
}

/** Updates the stored end time if Azure already lists the instance; leaves it alone otherwise. */
async function reconcileActivation(
  store: ProfileStore,
  profileName: string,
  config: PimConfig,
  token: string,
): Promise<void> {
  try {
    const inst = await findActiveForProfile(config, token);
    const end = inst?.properties.endDateTime;
    if (end && store.getActivation(profileName)?.endDateTime !== end) {
      await store.setActivation(profileName, { endDateTime: end });
    }
  } catch (err) {
    console.warn(`PIM: failed to reconcile activation for "${profileName}": ${describeError(err)}`);
  }
}

/** Azure's PIM policy rejected the requested duration (Expiration rule). */
function isDurationTooLong(err: unknown): boolean {
  return (
    err instanceof AzureRequestError &&
    err.azureCode === "RoleAssignmentRequestPolicyValidationFailed" &&
    /Expiration/i.test(err.azureMessage ?? "")
  );
}

/** Silently re-checks every profile's activation state. Never prompts for sign-in. */
export async function refreshActivations(store: ProfileStore): Promise<void> {
  for (const p of store.list()) {
    try {
      const token = await getArmToken(p.tenantId, { silent: true });
      if (!token) continue;

      const config = profileToConfig(p);
      const oid = decodeClaims(token).oid;
      if (oid) config.principalId = oid;

      const inst = await findActiveForProfile(config, token);
      if (!inst) {
        await store.setActivation(p.name, undefined);
        continue;
      }
      const end = inst.properties.endDateTime;
      const previous = store.getActivation(p.name);
      const same = previous && previous.endDateTime === end;
      await store.setActivation(p.name, {
        endDateTime: end,
        remindedFor: same ? previous.remindedFor : undefined,
        expiredNotifiedFor: same ? previous.expiredNotifiedFor : undefined,
      });
    } catch (err) {
      console.warn(`PIM: failed to refresh activation for "${p.name}": ${describeError(err)}`);
    }
  }
}
