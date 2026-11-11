// Microsoft sign-in via VS Code's built-in authentication provider.

import * as vscode from "vscode";

const ARM_SCOPE = "https://management.azure.com/.default";

export async function getArmToken(
  tenantId?: string,
  opts?: { silent?: boolean },
): Promise<string | undefined> {
  const silent = Boolean(opts?.silent);
  const scopes = [ARM_SCOPE, ...(tenantId ? [`VSCODE_TENANT:${tenantId}`] : [])];

  const session = await vscode.authentication.getSession(
    "microsoft",
    scopes,
    silent ? { silent: true } : { createIfNone: true },
  );

  if (!session) {
    if (silent) return undefined;
    throw new Error("Microsoft sign-in was not completed.");
  }

  return session.accessToken;
}

export interface TokenClaims {
  oid?: string;
  tid?: string;
  name?: string;
  upn?: string;
  givenName?: string;
}

// Reads the signed-in user's details from the access token claims. Never throws.
export function decodeClaims(token: string): TokenClaims {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

    return {
      oid: str(claims.oid),
      tid: str(claims.tid),
      name: str(claims.name),
      upn: str(claims.upn) ?? str(claims.unique_name) ?? str(claims.email),
      givenName: str(claims.given_name) ?? str(claims.name)?.split(" ")[0],
    };
  } catch {
    return {};
  }
}
