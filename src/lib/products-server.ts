import { z } from "zod";
import { ApiError } from "./http";
export function pathId(request: Request, collection: string): string {
  const parts = new URL(request.url).pathname.split("/");
  const parsed = z.uuid().safeParse(parts[parts.indexOf(collection) + 1]);
  if (!parsed.success)
    throw new ApiError(400, "INVALID_INPUT", "Invalid resource ID.");
  return parsed.data;
}
