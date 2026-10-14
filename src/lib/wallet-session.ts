import type { MeData } from "@/lib/types";

export async function fetchMe(): Promise<MeData | null> {
  const response = await fetch("/api/me", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await response.json();
  // An absent session is expected during restoration. A rejected wallet
  // identity is a different error and must retain the server's explanation.
  if (response.status === 401 && body.error?.code === "AUTH_REQUIRED")
    return null;
  if (!response.ok)
    throw new Error(
      body.error?.message ||
        "Your account could not be loaded. Please try again.",
    );
  return body.data as MeData;
}
