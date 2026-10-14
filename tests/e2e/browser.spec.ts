import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
test("public site, wallet guidance and unauthenticated route protection", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Every product",
  );
  expect(
    await page
      .locator("body")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: /continue.*metamask/i }).click();
  await expect(
    page
      .getByRole("region", { name: "Connect your wallet" })
      .getByRole("alert"),
  ).toContainText(/install.*metamask/i);
  await page.goto("/verify");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Know the product",
  );
});
test("mobile public page has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page
      .locator("body")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
test("actual browser compressor preserves alpha, limits dimensions and bounds output", async ({
  page,
}) => {
  await page.goto("/");
  const source = await readFile(
    new URL("../../src/lib/image-compression.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const result = await page.evaluate(async (code) => {
    const exports: Record<string, unknown> = {};
    new Function("exports", code)(exports);
    const compress = exports.compressProductImage as (
      file: File,
    ) => Promise<{ blob: Blob; width: number; height: number }>;
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(40,220,160,0.5)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const input = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png"),
    );
    const output = await compress(
      new File([input], "product.png", { type: "image/png" }),
    );
    const bitmap = await createImageBitmap(output.blob);
    const check = document.createElement("canvas");
    check.width = 1;
    check.height = 1;
    const ctx = check.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
    bitmap.close();
    let rejected = false;
    try {
      await compress(new File(["text"], "bad.svg", { type: "image/svg+xml" }));
    } catch {
      rejected = true;
    }
    return {
      type: output.blob.type,
      bytes: output.blob.size,
      width: output.width,
      height: output.height,
      alpha,
      rejected,
    };
  }, js);
  expect(result.type).toBe("image/webp");
  expect(result.width).toBe(1600);
  expect(result.height).toBe(800);
  expect(result.bytes).toBeLessThanOrEqual(1024 * 1024);
  expect(result.alpha).toBeGreaterThan(0);
  expect(result.alpha).toBeLessThan(255);
  expect(result.rejected).toBe(true);
});
