// UI contract tests use intercepted API fixtures only. Real authentication and
// database authorization are tested separately; no app authentication bypass exists.
import { test, expect, type Page } from "@playwright/test";
import type {
  Claim,
  Profile,
  Product,
  ProductDetail,
  Role,
} from "../../src/lib/types";
import { ROLES, ROLE_LABELS } from "../../src/lib/types";
const ids = {
  manufacturer: "10000000-0000-4000-8000-000000000001",
  retailer: "10000000-0000-4000-8000-000000000002",
  customer: "10000000-0000-4000-8000-000000000003",
  service_center: "10000000-0000-4000-8000-000000000005",
};
const wallets = {
  manufacturer: `0x${"1".repeat(40)}`,
  retailer: `0x${"2".repeat(40)}`,
  customer: `0x${"3".repeat(40)}`,
  service_center: `0x${"5".repeat(40)}`,
};
function profile(role: Role): Profile {
  return {
    id: ids[role],
    role,
    wallet_address: wallets[role],
    display_name: "Test User",
    organization_name: role === "customer" ? null : "Test Organization",
    onboarding_completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}
function product(role: Role): Product {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    serial_number: "TEST-001",
    model: "Test Smartwatch",
    manufacturer_id: ids.manufacturer,
    manufacturer_name: "Test Organization",
    manufacturer_wallet: wallets.manufacturer,
    owner_id: ids[role],
    owner_wallet: wallets[role],
    warranty_duration_days: 365,
    max_claims: 3,
    claims_used: 0,
    warranty_started_at: new Date(Date.now() - 86400000).toISOString(),
    warranty_expires_at: new Date(Date.now() + 86400000 * 364).toISOString(),
    image_path: null,
    created_at: new Date().toISOString(),
  };
}
async function setup(
  page: Page,
  role: Role,
  withClaim = false,
  delayMe = false,
) {
  const user = profile(role);
  const item = product(role === "service_center" ? "customer" : role);
  const claims: Claim[] = withClaim
    ? [
        {
          id: "30000000-0000-4000-8000-000000000001",
          product_id: item.id,
          customer_id: ids.customer,
          service_center_id: ids.service_center,
          description: "Battery will not charge.",
          status: "submitted",
          decision_reason: null,
          resolution: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
          model: item.model,
          serial_number: item.serial_number,
          service_center_name: "Test Service",
          customer_wallet: wallets.customer,
        },
      ]
    : [];
  let submitted: unknown = null;
  let meRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let data: unknown;
    if (url.pathname === "/api/chain/status")
      data = { enabled: false, ready: false };
    else if (url.pathname === "/api/me") {
      if (delayMe)
        await new Promise((resolve) =>
          setTimeout(resolve, meRequests++ === 0 ? 10 : 250),
        );
      data = { profile: user, wallet_address: user.wallet_address };
    } else if (url.pathname === "/api/dashboard")
      data = {
        products: role === "service_center" ? [] : [item],
        transfers: [],
        claims,
      };
    else if (url.pathname === `/api/products/${item.id}`)
      data = {
        product: item,
        history: [],
        transfers: [],
        claims,
        services: [],
      } satisfies ProductDetail;
    else if (url.pathname === "/api/service-centers")
      data = [
        {
          id: ids.service_center,
          organization_name: "Test Service",
          wallet_address: wallets.service_center,
        },
      ];
    else if (url.pathname === "/api/claims" && method === "POST") {
      submitted = route.request().postDataJSON();
      const input = submitted as { description: string };
      const claim: Claim = {
        id: "30000000-0000-4000-8000-000000000001",
        product_id: item.id,
        customer_id: ids.customer,
        service_center_id: ids.service_center,
        description: input.description,
        status: "submitted",
        decision_reason: null,
        resolution: null,
        created_at: new Date().toISOString(),
        resolved_at: null,
      };
      claims.push(claim);
      data = claim;
    } else if (url.pathname.includes("/api/claims/") && method === "POST") {
      const input = route.request().postDataJSON();
      claims[0].status =
        input.action === "approve"
          ? "approved"
          : input.action === "complete"
            ? "completed"
            : "rejected";
      claims[0].resolution = input.resolution || null;
      data = claims[0];
    } else {
      await route.fulfill({
        status: 404,
        json: {
          error: {
            code: "TEST_NOT_FOUND",
            message: "Unexpected test API path",
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { data } });
  });
  return { item, user, getSubmitted: () => submitted };
}
for (const role of ROLES)
  test(`${role} workspace renders its actual role and responsive navigation`, async ({
    page,
  }) => {
    await setup(page, role);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Welcome, Test User",
    );
    await expect(
      page.getByText(`${ROLE_LABELS[role]} workspace`, { exact: true }),
    ).toBeVisible();
    if (role === "manufacturer")
      await expect(
        page
          .getByRole("link", { name: "Register product", exact: true })
          .first(),
      ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page
        .locator("body")
        .evaluate((element) => element.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: "Workspace navigation" }),
    ).toBeVisible();
  });
test("customer selects a service center and submits a claim from the product passport", async ({
  page,
}) => {
  const state = await setup(page, "customer");
  await page.goto(`/products/${state.item.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    state.item.model,
  );
  await page.getByRole("tab", { name: "Warranty", exact: true }).click();
  await page
    .getByLabel("Service center", { exact: true })
    .selectOption(ids.service_center);
  await page.getByLabel("Describe the issue").fill("Battery will not charge.");
  await page.getByRole("button", { name: "Submit warranty request" }).click();
  await expect(
    page.getByText(
      "Warranty request submitted to your selected service center.",
    ),
  ).toBeVisible();
  expect(state.getSubmitted()).toEqual({
    product_id: state.item.id,
    service_center_id: ids.service_center,
    description: "Battery will not charge.",
  });
  await expect(
    page.getByText("This product already has an open warranty request.", {
      exact: false,
    }),
  ).toBeVisible();
});
test("assigned service center approves and records a completed repair", async ({
  page,
}) => {
  await setup(page, "service_center", true);
  await page.goto("/claims");
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.getByRole("button", { name: "Record completed repair" }).click();
  await page
    .getByLabel("Repair performed & outcome")
    .fill("Battery replaced and charging verified.");
  await page.getByRole("button", { name: "Complete & record repair" }).click();
  await expect(
    page.getByText(
      "Repair completed and recorded. One service claim has been used.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(
    page.getByText("Battery replaced and charging verified.", { exact: false }),
  ).toBeVisible();
});
test("delayed wallet restoration stays on the requested page", async ({
  page,
}) => {
  await setup(page, "service_center", true, true);
  await page.goto("/claims");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Warranty claims",
  );
  await expect(
    page.getByRole("button", { name: "Approve request" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/claims$/);
});
