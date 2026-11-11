// Structured errors for failed Azure REST calls.

export class AzureRequestError extends Error {
  httpStatus: string;
  azureCode?: string;
  azureMessage?: string;
  url?: string;
  correlationId?: string;

  constructor(
    message: string,
    details: {
      httpStatus: string;
      azureCode?: string;
      azureMessage?: string;
      url?: string;
      correlationId?: string;
    },
  ) {
    super(message);
    this.name = "AzureRequestError";
    this.httpStatus = details.httpStatus;
    this.azureCode = details.azureCode;
    this.azureMessage = details.azureMessage;
    this.url = details.url;
    this.correlationId = details.correlationId;
  }
}

export async function createAzureError(action: string, res: Response): Promise<AzureRequestError> {
  let responseText = "";
  try {
    responseText = await res.text();
  } catch {
    // Body unreadable; keep empty.
  }

  let azureCode: string | undefined;
  let azureMessage: string | undefined = responseText || undefined;

  try {
    const parsed = JSON.parse(responseText) as { error?: { code?: string; message?: string } };
    azureCode = parsed.error?.code;
    azureMessage = parsed.error?.message || responseText || undefined;
  } catch {
    // Response body was not JSON; keep the raw text.
  }

  return new AzureRequestError(`${action} failed.`, {
    httpStatus: `${res.status} ${res.statusText}`.trim(),
    azureCode,
    azureMessage,
    url: res.url,
    correlationId:
      res.headers.get("x-ms-correlation-request-id") ||
      res.headers.get("x-ms-request-id") ||
      undefined,
  });
}

// One line suitable for a notification.
export function describeError(err: unknown): string {
  if (err instanceof AzureRequestError) {
    const parts = [err.message];
    const detail = [err.azureCode, err.azureMessage !== err.message ? err.azureMessage : undefined]
      .filter(Boolean)
      .join(": ");
    parts.push(detail || err.httpStatus);
    if (err.correlationId) parts.push(`(correlation ID: ${err.correlationId})`);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    return (causeMsg ? `${err.message} (${causeMsg})` : err.message).replace(/\s+/g, " ").trim();
  }

  return String(err);
}
