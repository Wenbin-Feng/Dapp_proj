import assert from "node:assert/strict";
import test from "node:test";
import { waitForDeployment } from "../scripts/wait-for-vercel.mjs";

const DEPLOYMENT = "dpl_test123";
const HOSTNAME = "dapp-proj-test-example.vercel.app";
const TOKEN = "unit-test-token-never-a-real-credential";
const TEAM_ID = "team_test123";
const PROJECT_ID = "prj_test123";
const SHA = "a".repeat(40);
const UPSTREAM_MESSAGE = "untrusted-upstream-message-with-private-account-data";

function deployment(overrides = {}) {
  return {
    id: DEPLOYMENT,
    url: HOSTNAME,
    projectId: PROJECT_ID,
    meta: { githubCommitSha: SHA },
    readyState: "READY",
    aliasAssigned: true,
    ...overrides,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function harness(steps, overrides = {}) {
  let clock = 0;
  let index = 0;
  const requests = [];
  const logs = [];
  const sleeps = [];
  const controls = {
    advance(milliseconds) {
      clock += milliseconds;
    },
    now() {
      return clock;
    },
  };
  const options = {
    deployment: DEPLOYMENT,
    token: TOKEN,
    teamId: TEAM_ID,
    expectedProjectId: PROJECT_ID,
    expectedSha: SHA,
    timeoutMs: 50,
    pollIntervalMs: 10,
    requestTimeoutMs: 20,
    now: controls.now,
    sleep: async (milliseconds) => {
      assert.ok(milliseconds >= 0, "sleep duration must not be negative");
      sleeps.push(milliseconds);
      controls.advance(milliseconds);
    },
    log: (...values) => logs.push(values.map(String).join(" ")),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      const step = steps[Math.min(index++, steps.length - 1)];
      assert.notEqual(step, undefined, "unexpected network request");
      if (typeof step === "function") return step(url, init, controls);
      if (step instanceof Error) throw step;
      return json(step);
    },
    ...overrides,
  };
  return { options, requests, logs, sleeps, controls };
}

function assertSanitized(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(!output.includes(TOKEN), "credentials must not reach output");
  assert.ok(
    !output.includes(UPSTREAM_MESSAGE),
    "untrusted upstream messages must not reach output",
  );
}

test("waits through initialization and delayed production aliases", async () => {
  const run = harness([
    deployment({ readyState: "INITIALIZING", aliasAssigned: false }),
    deployment({ readyState: "BUILDING", aliasAssigned: false }),
    deployment({ readyState: "READY", aliasAssigned: false }),
    deployment({ readyState: "READY", aliasAssigned: true }),
  ]);

  const result = await waitForDeployment(run.options);

  assert.equal(result.id, DEPLOYMENT);
  assert.equal(result.readyState, "READY");
  assert.equal(result.aliasAssigned, true);
  assert.equal(run.requests.length, 4);
  assert.equal(run.sleeps.length, 3);
  for (const request of run.requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, "https://api.vercel.com");
    assert.equal(url.pathname, `/v13/deployments/${DEPLOYMENT}`);
    assert.equal(url.searchParams.get("teamId"), TEAM_ID);
    assert.equal(url.searchParams.get("withGitRepoInfo"), "true");
    assert.equal(
      new Headers(request.init.headers).get("authorization"),
      `Bearer ${TOKEN}`,
    );
    assert.equal(request.init.redirect, "error");
    assert.ok(request.init.signal instanceof AbortSignal);
  }
  assertSanitized(run.logs);
});

test("normalizes supported deployment references without querying account APIs", async (t) => {
  for (const reference of [
    DEPLOYMENT,
    HOSTNAME,
    `https://${HOSTNAME}`,
    `https://${HOSTNAME}/`,
  ]) {
    await t.test(reference, async () => {
      const run = harness([deployment()], { deployment: reference });
      await waitForDeployment(run.options);
      assert.equal(run.requests.length, 1);
      const url = new URL(run.requests[0].url);
      const lookup = reference === DEPLOYMENT ? DEPLOYMENT : HOSTNAME;
      assert.equal(url.pathname, `/v13/deployments/${lookup}`);
      assert.ok(!url.pathname.includes("/user"));
    });
  }
});

test("rejects unsafe deployment references before sending credentials", async (t) => {
  const invalid = [
    "https://example.com",
    "https://vercel.app",
    "https://preview.vercel.app.attacker.example",
    "http://preview.vercel.app",
    "https://user:password@preview.vercel.app",
    "https://preview.vercel.app/path",
    "https://preview.vercel.app?token=secret",
    "https://preview.vercel.app#fragment",
    "preview.vercel.app/path",
    "dpl_test123?teamId=other",
    "dpl_test123/../../v2/user",
    "",
  ];
  for (const reference of invalid) {
    await t.test(reference || "empty", async () => {
      const run = harness([deployment()], { deployment: reference });
      await assert.rejects(waitForDeployment(run.options));
      assert.equal(run.requests.length, 0);
      assertSanitized(run.logs);
    });
  }
});

test("stops immediately on deployment or alias failure without leaking upstream text", async (t) => {
  for (const state of ["ERROR", "CANCELED", "BLOCKED", "alias-error"]) {
    await t.test(state, async () => {
      const body = deployment({
        readyState: state === "alias-error" ? "READY" : state,
        aliasAssigned: false,
        errorMessage: `${UPSTREAM_MESSAGE} ${TOKEN}`,
        ...(state === "alias-error"
          ? { aliasError: { code: "alias_failure", message: UPSTREAM_MESSAGE } }
          : {}),
      });
      const run = harness([body]);
      await assert.rejects(waitForDeployment(run.options), (error) => {
        assertSanitized(error.message);
        return true;
      });
      assert.equal(run.requests.length, 1);
      assert.equal(run.sleeps.length, 0);
      assertSanitized(run.logs);
    });
  }
});

test("retries transient HTTP, transport, and malformed JSON failures", async () => {
  const run = harness(
    [
      () => json({ error: { message: UPSTREAM_MESSAGE } }, 404),
      () => json({ error: { message: UPSTREAM_MESSAGE } }, 429),
      () => json({ error: { message: UPSTREAM_MESSAGE } }, 503),
      new Error(`${UPSTREAM_MESSAGE} ${TOKEN}`),
      () => new Response(`invalid JSON ${UPSTREAM_MESSAGE}`, { status: 200 }),
      deployment(),
    ],
    { timeoutMs: 100 },
  );
  const result = await waitForDeployment(run.options);
  assert.equal(result.readyState, "READY");
  assert.equal(run.requests.length, 6);
  assertSanitized(run.logs);
});

test("fails authorization errors immediately instead of polling to timeout", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      const run = harness([
        () =>
          json(
            { error: { message: `${UPSTREAM_MESSAGE} ${TOKEN}` } },
            status,
          ),
      ]);
      await assert.rejects(waitForDeployment(run.options), (error) => {
        assertSanitized(error.message);
        return true;
      });
      assert.equal(run.requests.length, 1);
      assert.equal(run.sleeps.length, 0);
      assertSanitized(run.logs);
    });
  }
});

test("applies a global deadline to non-ready states and transient errors", async (t) => {
  for (const [name, step] of [
    ["initializing", deployment({ readyState: "INITIALIZING", aliasAssigned: false })],
    ["aliases", deployment({ aliasAssigned: false })],
    ["HTTP retry", () => json({ error: { message: UPSTREAM_MESSAGE } }, 503)],
    ["network retry", new Error(UPSTREAM_MESSAGE)],
    ["invalid JSON", () => new Response("invalid JSON", { status: 200 })],
  ]) {
    await t.test(name, async () => {
      const run = harness([step], { timeoutMs: 25 });
      await assert.rejects(waitForDeployment(run.options), (error) => {
        assertSanitized(error.message);
        return true;
      });
      assert.ok(run.requests.length > 0);
      assert.ok(run.requests.length <= 4, "retrying must stop at the deadline");
      assert.ok(run.controls.now() <= 25, "sleep must respect the remaining deadline");
      assertSanitized(run.logs);
    });
  }
});

test("does not accept a ready result that arrives after the deadline", async () => {
  const run = harness([
    (_url, _init, controls) => {
      controls.advance(51);
      return json(deployment());
    },
  ]);
  await assert.rejects(waitForDeployment(run.options));
  assert.equal(run.requests.length, 1);
});

test("aborts stalled requests so a deployment cannot hang forever", { timeout: 2000 }, async () => {
  let aborted = false;
  const run = harness(
    [
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => {
            aborted = true;
            reject(init.signal.reason || new Error("Request aborted"));
          };
          if (init.signal.aborted) abort();
          else init.signal.addEventListener("abort", abort, { once: true });
        }),
    ],
    { timeoutMs: 10, requestTimeoutMs: 5, pollIntervalMs: 5 },
  );
  await assert.rejects(waitForDeployment(run.options));
  assert.equal(aborted, true);
  assert.ok(run.requests.length <= 3);
});

test("validates project and commit identity before accepting a successful deployment", async (t) => {
  const invalid = [
    ["different project", { projectId: "prj_other" }],
    ["missing project", { projectId: undefined }],
    ["different commit metadata", { meta: { githubCommitSha: "b".repeat(40) } }],
    ["missing commit", { meta: {} }],
    ["conflicting project fields", { project: { id: "prj_other" } }],
    ["conflicting commit fields", { gitSource: { sha: "b".repeat(40) } }],
  ];
  for (const [name, overrides] of invalid) {
    await t.test(name, async () => {
      const run = harness([deployment(overrides)]);
      await assert.rejects(waitForDeployment(run.options));
      assert.equal(run.requests.length, 1);
      assert.equal(run.sleeps.length, 0);
    });
  }
  await t.test("nested project and git source fields are accepted", async () => {
    const run = harness([
      deployment({
        projectId: undefined,
        project: { id: PROJECT_ID },
        meta: {},
        gitSource: { sha: SHA },
      }),
    ]);
    const result = await waitForDeployment(run.options);
    assert.equal(result.readyState, "READY");
  });
});

test("returns only a safe deployment summary and ignores injected response details", async () => {
  const run = harness([
    deployment({
      owner: { token: TOKEN },
      meta: { githubCommitSha: SHA, privateText: UPSTREAM_MESSAGE },
      errorMessage: UPSTREAM_MESSAGE,
      arbitrary: `${UPSTREAM_MESSAGE} ${TOKEN}`,
    }),
  ]);
  const result = await waitForDeployment(run.options);
  assert.equal(result.id, DEPLOYMENT);
  assert.equal(result.readyState, "READY");
  assert.equal(result.aliasAssigned, true);
  assertSanitized(result);
  assertSanitized(run.logs);
  assert.equal(Object.hasOwn(result, "owner"), false);
  assert.equal(Object.hasOwn(result, "meta"), false);
  assert.equal(Object.hasOwn(result, "arbitrary"), false);
  assert.equal(Object.hasOwn(result, "errorMessage"), false);
});
