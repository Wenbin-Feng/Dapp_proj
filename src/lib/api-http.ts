export class ClientApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options?.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok)
    throw new ClientApiError(
      payload.error?.message || "Something went wrong. Please try again.",
      payload.error?.code || "REQUEST_FAILED",
      response.status,
    );
  return payload.data as T;
}
