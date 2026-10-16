const base = new URL(process.env.DEMO_APP_URL || "http://localhost:3000");
const token = process.env.DEMO_INDEXER_TOKEN;
if (!token || token.length < 32)
  throw new Error(
    "Configure a server-only DEMO_INDEXER_TOKEN of at least 32 characters",
  );
for (let batch = 0; batch < 20; batch++) {
  const response = await fetch(new URL("/api/chain/sync", base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base.origin,
      authorization: `Bearer ${token}`,
    },
    body: "{}",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || "Index sync failed");
  console.log(JSON.stringify(result.data));
  if (!result.data.backlog) process.exit(0);
}
throw new Error(
  "The index has more backlog. Re-run to continue from its saved cursor.",
);
