import "server-only";
import { resolve, sep } from "node:path";
import { ApiError } from "./http";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function localImagePath(objectPath: string) {
  if (!new RegExp(`^products/${uuid}/${uuid}\\.webp$`, "i").test(objectPath))
    throw new ApiError(400, "INVALID_FILE", "Invalid image path.");
  // Uploaded user files are runtime data, not bundled application assets.
  const root = resolve(
    /* turbopackIgnore: true */ process.env.LOCAL_UPLOAD_DIR || "data/uploads",
  );
  const file = resolve(root, objectPath);
  if (!file.startsWith(root + sep))
    throw new ApiError(400, "INVALID_FILE", "Invalid image path.");
  return file;
}
