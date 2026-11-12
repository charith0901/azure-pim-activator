// Azure Resource Manager discovery helpers (tenants, subscriptions, eligibilities).

import { createAzureError } from "./errors";
import type { ArmScheduleInstance, Eligibility, Subscription, Tenant } from "./types";

export const MANAGEMENT_URL = "https://management.azure.com";

/** Throws unless the URL is on Azure Resource Manager, so the bearer token is never sent elsewhere. */
export function assertArmUrl(url: string): string {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error("Refusing to send credentials to an invalid URL.");
  }
  if (origin !== MANAGEMENT_URL) {
    throw new Error(`Refusing to send credentials to ${origin}; only ${MANAGEMENT_URL} is allowed.`);
  }
  return url;
}

interface ArmPage<T> {
  value?: T[];
  nextLink?: string;
}

// GETs an ARM list endpoint, following nextLink pages, and returns all `value` items.
export async function armGetAll<T>(url: string, token: string, action: string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const response: Response = await fetch(assertArmUrl(nextUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept-Language": "en-US",
      },
    });

    if (!response.ok) {
      throw await createAzureError(action, response);
    }

    const page = (await response.json()) as ArmPage<T>;
    if (Array.isArray(page.value)) {
      items.push(...page.value);
    }
    nextUrl = page.nextLink || undefined;
  }

  return items;
}

function byText<T>(selector: (item: T) => string | undefined): (a: T, b: T) => number {
  return (a, b) =>
    String(selector(a) || "").localeCompare(String(selector(b) || ""), undefined, {
      sensitivity: "base",
    });
}

interface RawTenant {
  tenantId: string;
  displayName?: string;
  defaultDomain?: string;
}

export async function listTenants(token: string): Promise<Tenant[]> {
  const items = await armGetAll<RawTenant>(
    `${MANAGEMENT_URL}/tenants?api-version=2022-12-01`,
    token,
    "Listing tenants",
  );

  return items
    .map((t) => ({
      tenantId: t.tenantId,
      displayName: t.displayName || t.defaultDomain || t.tenantId,
      defaultDomain: t.defaultDomain,
    }))
    .sort(byText((t) => t.displayName));
}

interface RawSubscription {
  subscriptionId: string;
  displayName?: string;
  state?: string;
  tenantId?: string;
}

export async function listSubscriptions(token: string, tenantId: string): Promise<Subscription[]> {
  const items = await armGetAll<RawSubscription>(
    `${MANAGEMENT_URL}/subscriptions?api-version=2022-12-01`,
    token,
    "Listing subscriptions",
  );
  const wanted = String(tenantId || "").toLowerCase();

  return items
    .filter((s) => String(s.tenantId || "").toLowerCase() === wanted && s.state === "Enabled")
    .map((s) => ({
      subscriptionId: s.subscriptionId,
      displayName: s.displayName || s.subscriptionId,
      state: s.state || "",
    }))
    .sort(byText((s) => s.displayName));
}

// Pulls the subscription ID and resource group name out of an ARM scope (either may be absent,
// e.g. for a management-group scope).
export function parseScope(scope: string): { subscriptionId?: string; resourceGroup?: string } {
  return {
    subscriptionId: /\/subscriptions\/([^/]+)/i.exec(scope)?.[1],
    resourceGroup: /\/resourcegroups\/([^/]+)/i.exec(scope)?.[1],
  };
}

/**
 * Returns the caller's currently-valid PIM eligibilities.
 *
 * With no `scope`, this queries the provider-level endpoint, which lists every eligibility the
 * caller has in the tenant and needs no RBAC on any subscription or resource group:
 *   GET https://management.azure.com/providers/Microsoft.Authorization/roleEligibilityScheduleInstances
 *       ?api-version=2020-10-01&$filter=asTarget()
 *
 * Example item from `value`:
 * {
 *   "properties": {
 *     "roleEligibilityScheduleId": "/subscriptions/00000000-0000-0000-0000-000000000000/resourcegroups/my-resource-group/providers/Microsoft.Authorization/roleEligibilitySchedules/11111111-1111-1111-1111-111111111111",
 *     "scope": "/subscriptions/00000000-0000-0000-0000-000000000000/resourcegroups/my-resource-group",
 *     "roleDefinitionId": "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c",
 *     "principalId": "22222222-2222-2222-2222-222222222222",
 *     "principalType": "User",
 *     "status": "Provisioned",
 *     "startDateTime": "2026-08-20T08:38:51.307Z",
 *     "endDateTime": "2027-08-20T08:38:23.017Z",
 *     "memberType": "Direct",
 *     "createdOn": "2026-08-20T08:38:51.307Z",
 *     "expandedProperties": {
 *       "principal": { "id": "22222222-…", "displayName": "…", "email": "…", "type": "User", "userPrincipalName": "…" },
 *       "roleDefinition": {
 *         "id": "/subscriptions/00000000-…/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c",
 *         "displayName": "Contributor",
 *         "type": "BuiltInRole"
 *       },
 *       "scope": {
 *         "id": "/subscriptions/00000000-0000-0000-0000-000000000000/resourcegroups/my-resource-group",
 *         "displayName": "my-resource-group",
 *         "type": "resourcegroup"
 *       }
 *     }
 *   },
 *   "name": "11111111-1111-1111-1111-111111111111",
 *   "id": "/subscriptions/00000000-…/resourcegroups/my-resource-group/providers/Microsoft.Authorization/roleEligibilityScheduleInstances/11111111-1111-1111-1111-111111111111",
 *   "type": "Microsoft.Authorization/roleEligibilityScheduleInstances"
 * }
 */
export async function listMyEligibilities(token: string, scope = ""): Promise<Eligibility[]> {
  const items = await armGetAll<ArmScheduleInstance>(
    `${MANAGEMENT_URL}${scope}/providers/Microsoft.Authorization/roleEligibilityScheduleInstances` +
      `?api-version=2020-10-01&$filter=asTarget()`,
    token,
    "Listing eligible PIM roles",
  );
  const now = Date.now();

  return items
    .filter((item) => {
      const p = item?.properties;
      if (p?.status !== "Provisioned") return false;
      if (p.startDateTime && new Date(p.startDateTime).getTime() > now) return false;
      if (p.endDateTime && new Date(p.endDateTime).getTime() <= now) return false;
      return true;
    })
    .map((item): Eligibility => {
      const p = item.properties;
      const exp = p.expandedProperties;
      const roleDefinitionId = p.roleDefinitionId?.split("/").filter(Boolean).pop() || "";
      const itemScope = p.scope || "";
      const { subscriptionId, resourceGroup } = parseScope(itemScope);
      return {
        raw: item,
        roleName: exp?.roleDefinition?.displayName || roleDefinitionId,
        roleDefinitionId,
        scope: itemScope,
        scopeName: exp?.scope?.displayName,
        scopeType: exp?.scope?.type,
        subscriptionId,
        resourceGroup,
        principalId: p.principalId,
        endDateTime: p.endDateTime,
      };
    })
    .sort((a, b) => {
      const byScope = byText<Eligibility>((e) => e.scopeName || e.scope)(a, b);
      return byScope !== 0 ? byScope : byText<Eligibility>((e) => e.roleName)(a, b);
    });
}
