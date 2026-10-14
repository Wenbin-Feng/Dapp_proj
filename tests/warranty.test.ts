import { it, expect } from "vitest";
import { warrantyStatus } from "../src/lib/format";
const product = {
  warranty_started_at: "2026-01-01T00:00:00Z",
  warranty_expires_at: "2027-01-01T00:00:00Z",
  claims_used: 0,
  max_claims: 3,
};
it("treats the exact expiration instant as expired", () => {
  expect(warrantyStatus(product, Date.parse("2026-12-31T23:59:59Z"))).toBe(
    "active",
  );
  expect(warrantyStatus(product, Date.parse(product.warranty_expires_at))).toBe(
    "expired",
  );
});
it("does not activate warranty merely because a product exists", () => {
  expect(warrantyStatus({ ...product, warranty_started_at: null })).toBe(
    "not_started",
  );
});
it("exhausts warranty at the claim limit", () => {
  expect(
    warrantyStatus({ ...product, claims_used: 3 }, Date.parse("2026-05-01")),
  ).toBe("exhausted");
});
