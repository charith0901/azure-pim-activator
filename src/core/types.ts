// Shared contracts for the Azure PIM extension. Every module builds against these.

export const DEFAULT_ACTIVATION_HOURS = 8;
/** PIM accepts activations from 30 minutes up to 24 hours (the role's policy may cap it lower). */
export const MIN_ACTIVATION_HOURS = 0.5;
export const MAX_ACTIVATION_HOURS = 24;

/** ISO 8601 duration for ARM, e.g. 8 -> "PT480M". */
export function hoursToIsoDuration(hours: number): string {
  return `PT${Math.round(hours * 60)}M`;
}

export interface Profile {
  name: string;
  tenantId: string;
  tenantName: string;
  /** Empty when the eligibility is on a management group. */
  subscriptionId: string;
  subscriptionName: string;
  /** Empty when the eligibility is on a subscription or management group. */
  resourceGroup: string;
  /** Scope the eligibility was granted on (activation targets this). */
  scope: string;
  /** Display name of the scope (e.g. resource group name). */
  scopeName?: string;
  /** Object ID (oid) of the signed-in user. */
  principalId: string;
  /** Role definition GUID (last segment). */
  roleDefinitionId: string;
  roleName: string;
  /** Per-profile activation length in hours. Unset = use the pim.activationHours setting. */
  activationHours?: number;
  /** @deprecated Written by 0.2.x as a fixed "PT480M"; ignored. */
  activationDuration?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface Tenant {
  tenantId: string;
  displayName: string;
  defaultDomain?: string;
}

export interface Subscription {
  subscriptionId: string;
  displayName: string;
  state: string;
}

export interface ResourceGroup {
  name: string;
  location: string;
  id: string;
}

/** Raw ARM resource for roleEligibilityScheduleInstances / roleAssignmentScheduleInstances. */
export interface ArmScheduleInstance {
  id: string;
  name: string;
  properties: {
    scope?: string;
    roleDefinitionId?: string;
    principalId?: string;
    status?: string;
    startDateTime?: string;
    endDateTime?: string;
    roleEligibilityScheduleId?: string;
    roleAssignmentScheduleId?: string;
    linkedRoleEligibilityScheduleId?: string;
    assignmentType?: string;
    expandedProperties?: {
      principal?: { id?: string; displayName?: string };
      roleDefinition?: { id?: string; displayName?: string };
      scope?: { id?: string; displayName?: string; type?: string };
    };
  };
}

/** A user's eligible role, as listed in the wizard. */
export interface Eligibility {
  raw: ArmScheduleInstance;
  roleName: string;
  roleDefinitionId: string;
  scope: string;
  scopeName?: string;
  /** e.g. "resourcegroup", "subscription", "managementgroup". */
  scopeType?: string;
  /** Parsed from scope; absent for management-group scopes. */
  subscriptionId?: string;
  /** Parsed from scope; absent for subscription / management-group scopes. */
  resourceGroup?: string;
  principalId?: string;
  endDateTime?: string;
}

/** Runtime config for activation, derived from a Profile. */
export interface PimConfig {
  tenantId: string;
  subscriptionId: string;
  principalId: string;
  scope: string;
  roleDefinitionId: string;
  roleName: string;
  activationDuration: string;
}

/** Last known activation for a profile, persisted by the store. */
export interface ActivationRecord {
  endDateTime?: string;
  /** ISO time a reminder was shown for this endDateTime (prevents repeats). */
  remindedFor?: string;
}

export function profileToConfig(p: Profile, hours: number = DEFAULT_ACTIVATION_HOURS): PimConfig {
  return {
    tenantId: p.tenantId,
    subscriptionId: p.subscriptionId,
    principalId: p.principalId,
    scope: p.scope,
    roleDefinitionId: p.roleDefinitionId,
    roleName: p.roleName,
    activationDuration: hoursToIsoDuration(hours),
  };
}
