import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function checkOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next's dev server can use its bind address in request.url. Host retains the
  // browser-facing origin; browsers cannot override this forbidden header.
  const host = request.headers.get("host");
  let protocol = url.protocol;
  // Vercel controls this platform header. Other deployments must not trust a
  // caller-supplied forwarding header to change the expected origin.
  if (process.env.VERCEL === "1") {
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    if (forwardedProtocol !== null) {
      if (forwardedProtocol !== "http" && forwardedProtocol !== "https") {
        throw new ApiError(
          403,
          "INVALID_ORIGIN",
          "This request must come from this application.",
        );
      }
      protocol = `${forwardedProtocol}:`;
    }
  }
  let expectedOrigin = url.origin;
  if (host) {
    try {
      const external = new URL(`${protocol}//${host}`);
      if (external.host.toLowerCase() !== host.toLowerCase())
        throw new Error("Invalid host");
      expectedOrigin = external.origin;
    } catch {
      throw new ApiError(
        403,
        "INVALID_ORIGIN",
        "This request must come from this application.",
      );
    }
  }
  if (
    !origin ||
    origin !== (process.env.DAPP_PUBLIC_ORIGIN || expectedOrigin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new ApiError(
      403,
      "INVALID_ORIGIN",
      "This request must come from this application.",
    );
  }
}

export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    let response: Response;
    try {
      checkOrigin(request);
      response = await handler(request);
    } catch (error) {
      const known = error instanceof ApiError;
      response = Response.json(
        {
          error: {
            code: known ? error.code : "INTERNAL_ERROR",
            message: known
              ? error.message
              : "Something went wrong. Please try again.",
          },
        },
        { status: known ? error.status : 500 },
      );
    }
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  };
}

export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new ApiError(415, "JSON_REQUIRED", "Send this request as JSON.");
  }
  if (Number(request.headers.get("content-length")) > 65536) {
    throw new ApiError(413, "BODY_TOO_LARGE", "This request is too large.");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) {
          await reader.cancel().catch(() => undefined);
          throw new ApiError(
            413,
            "BODY_TOO_LARGE",
            "This request is too large.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    throw new ApiError(
      400,
      "INVALID_INPUT",
      `${field ? `${field}: ` : ""}${issue?.message || "Invalid request."}`,
    );
  }
  return parsed.data;
}
