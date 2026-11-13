// Azure PIM (Microsoft.Authorization) REST calls and activation polling.

import { randomUUID } from "crypto";
import { MANAGEMENT_URL, assertArmUrl } from "./arm";
import { createAzureError } from "./errors";
import type { ArmScheduleInstance, PimConfig } from "./types";

export const FAILED_STATUSES: string[] = ["Denied", "Failed", "Canceled", "Revoked", "TimedOut"];

function providerUrl(scope: string, resourcePath: string): string {
  return `${MANAGEMENT_URL}${scope}/providers/Microsoft.Authorization/${resourcePath}`;
}

function sameId(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function isUnexpired(instance: ArmScheduleInstance, now: Date): boolean {
  const end = instance.properties?.endDateTime;
  return !end || new Date(end) > now;
}

function principalOf(instance: ArmScheduleInstance): string | undefined {
  const p = instance.properties || {};
  return p.principalId || p.expandedProperties?.principal?.id;
}

function roleMatches(roleDefinitionId: string | undefined, wanted: string): boolean {
  return Boolean(
    roleDefinitionId && wanted && roleDefinitionId.toLowerCase().endsWith(wanted.toLowerCase()),
  );
}

export async function getEligibilityScheduleInstances(
  config: PimConfig,
  token: string,
): Promise<ArmScheduleInstance[]> {
  const url =
    providerUrl(config.scope, "roleEligibilityScheduleInstances") +
    `?api-version=2020-10-01` +
    `&$filter=asTarget()`;

  const response = await fetch(assertArmUrl(url), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "en-US",
    },
  });

  if (!response.ok) {
    throw await createAzureError("Checking existing eligible assignments", response);
  }

  const result = (await response.json()) as { value?: ArmScheduleInstance[] };
  return result.value || [];
}

export async function getRoleAssignmentScheduleInstances(
  scope: string,
  token: string,
): Promise<ArmScheduleInstance[]> {
  const url =
    providerUrl(scope, "roleAssignmentScheduleInstances") +
    `?api-version=2020-10-01-preview&%24filter=asTarget()%20and%20atScope()`;

  const response = await fetch(assertArmUrl(url), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw await createAzureError("Getting role assignment schedule instances", response);
  }

  const result = (await response.json()) as { value?: ArmScheduleInstance[] };
  return result.value || [];
}

function isActiveEligibility(item: ArmScheduleInstance, config: PimConfig, now: Date): boolean {
  const p = item.properties || {};

  const scopeMatches = sameId(p.scope, config.scope);
  const principalMatches = sameId(principalOf(item), config.principalId);
  const activeStatus = p.status === "Provisioned";
  const startValid = !p.startDateTime || new Date(p.startDateTime) <= now;
  const endValid = !p.endDateTime || new Date(p.endDateTime) > now;

  return (
    roleMatches(p.roleDefinitionId, config.roleDefinitionId) &&
    scopeMatches &&
    principalMatches &&
    activeStatus &&
    startValid &&
    endValid
  );
}

export async function findEligibleAssignments(
  config: PimConfig,
  token: string,
): Promise<ArmScheduleInstance[]> {
  const instances = await getEligibilityScheduleInstances(config, token);
  const now = new Date();
  return instances.filter((item) => isActiveEligibility(item, config, now));
}

// Returns the currently active instance for this eligibility, if any.
export async function findActiveInstance(
  config: PimConfig,
  token: string,
  roleEligibilityScheduleId: string,
): Promise<ArmScheduleInstance | undefined> {
  const instances = await getRoleAssignmentScheduleInstances(config.scope, token);
  const now = new Date();

  return instances.find(
    (instance) =>
      sameId(instance.properties?.linkedRoleEligibilityScheduleId, roleEligibilityScheduleId) &&
      isUnexpired(instance, now),
  );
}

// Returns the active assignment matching the profile's role/scope/principal (latest end wins).
export async function findActiveForProfile(
  config: PimConfig,
  token: string,
): Promise<ArmScheduleInstance | undefined> {
  const instances = await getRoleAssignmentScheduleInstances(config.scope, token);
  const now = Date.now();
  const endOf = (i: ArmScheduleInstance): number =>
    i.properties?.endDateTime ? new Date(i.properties.endDateTime).getTime() : NaN;

  const matches = instances.filter((instance) => {
    const p = instance.properties || {};
    const end = endOf(instance);
    return (
      roleMatches(p.roleDefinitionId, config.roleDefinitionId) &&
      sameId(p.scope, config.scope) &&
      sameId(principalOf(instance), config.principalId) &&
      Number.isFinite(end) &&
      end > now
    );
  });

  return matches.sort((a, b) => endOf(b) - endOf(a))[0];
}

/** Parses an ISO-8601 time duration like "PT480M" or "PT8H30M" into milliseconds. */
function isoDurationMs(duration: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(duration ?? "");
  if (!m) return NaN;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  return (((d * 24 + h) * 60 + min) * 60 + s) * 1000;
}

/** End time of a just-submitted activation, from Azure's response or start + requested duration. */
function expectedEnd(scheduleInfo: any, requestedDuration: string): string {
  const explicit = scheduleInfo?.expiration?.endDateTime;
  if (explicit) return String(explicit);
  const start = scheduleInfo?.startDateTime ? new Date(scheduleInfo.startDateTime).getTime() : Date.now();
  let ms = isoDurationMs(scheduleInfo?.expiration?.duration);
  if (!Number.isFinite(ms)) ms = isoDurationMs(requestedDuration);
  return new Date((Number.isFinite(start) ? start : Date.now()) + (ms || 0)).toISOString();
}

// Sends a SelfActivate request.
export async function createSelfActivationRequest(
  config: PimConfig,
  token: string,
  eligibilityInstanceName: string,
): Promise<{
  requestId: string;
  status: string;
  targetRoleAssignmentScheduleId?: string;
  endDateTime: string;
  raw: any;
}> {
  const { scope } = config;
  const requestId = randomUUID();

  const requestUrl =
    providerUrl(scope, `roleAssignmentScheduleRequests/${requestId}`) + `?api-version=2020-10-01`;

  const body = {
    properties: {
      principalId: config.principalId,
      requestType: "SelfActivate",
      roleDefinitionId: `${scope}/providers/Microsoft.Authorization/roleDefinitions/${config.roleDefinitionId}`,
      justification: new Date().toISOString(),
      scheduleInfo: {
        startDateTime: null,
        expiration: {
          duration: config.activationDuration,
          type: "AfterDuration",
        },
      },
      IsActivativation: true,
      IsValidationOnly: false,
      linkedRoleEligibilityScheduleId: `${scope}/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/${eligibilityInstanceName}`,
    },
  };

  const response = await fetch(assertArmUrl(requestUrl), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await createAzureError("Creating Role Assignment Schedule Request", response);
  }

  const raw: any = await response.json();
  return {
    requestId,
    status: String(raw?.properties?.status ?? ""),
    targetRoleAssignmentScheduleId: raw?.properties?.targetRoleAssignmentScheduleId || undefined,
    endDateTime: expectedEnd(raw?.properties?.scheduleInfo, config.activationDuration),
    raw,
  };
}

