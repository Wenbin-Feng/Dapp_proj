import { appendFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const pendingStates = new Set(["INITIALIZING", "QUEUED", "BUILDING", "DEPLOYING", "READY"]);
const failedStates = new Set(["ERROR", "CANCELED", "BLOCKED"]);

function deploymentReference(value) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("Invalid Vercel deployment reference.");
  }
  if (/^dpl_[a-zA-Z0-9]+$/.test(value)) return value;
  let url;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new Error("Invalid Vercel deployment reference.");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.pathname !== "/" || url.search || url.hash ||
    !/^[a-z0-9-]+\.vercel\.app$/i.test(url.hostname)
  ) throw new Error("Invalid Vercel deployment reference.");
  return url.hostname;
}

function safeCode(value, token) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) &&
    !value.includes(token) ? ` (${value})` : "";
}

// Uses only the team-scoped deployment endpoint. CLI inspect first queries the
// current user's profile, which can fail independently of a successful deployment.
export async function waitForDeployment({
  deployment,
  token,
  teamId,
  expectedProjectId,
  expectedSha,
  timeoutMs = 300_000,
  pollIntervalMs = 3_000,
  requestTimeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => delay(ms),
  log = console.log,
}) {
  const reference = deploymentReference(deployment);
  if (typeof token !== "string" || !token.trim()) throw new Error("VERCEL_TOKEN is required.");
  if (!/^team_[a-zA-Z0-9]+$/.test(teamId || "")) throw new Error("A valid VERCEL_ORG_ID is required.");
  if (expectedProjectId !== undefined && !/^prj_[a-zA-Z0-9]+$/.test(expectedProjectId)) {
    throw new Error("Invalid expected Vercel project ID.");
  }
  if (expectedSha !== undefined && !/^[a-f0-9]{40}$/i.test(expectedSha)) {
    throw new Error("Invalid expected Git commit SHA.");
  }
  for (const value of [timeoutMs, pollIntervalMs, requestTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Polling intervals must be positive integers.");
  }
  const url = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(reference)}`);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("withGitRepoInfo", "true");
  const deadline = now() + timeoutMs;
  let lastState = "not yet available";
  let lastQuery = "none";
  let previousProgress;
  const pause = async (ms = pollIntervalMs) => {
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(ms, remaining));
  };
  while (now() < deadline) {
    let response;
    let data;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(requestTimeoutMs, deadline - now())),
      });
      if (response.ok) data = await response.json();
    } catch {
      // Upstream exceptions and response bodies may contain credentials or
      // environment data. Log fixed diagnostics instead of serializing them.
      lastQuery = "network or response parsing error";
      log("Vercel deployment query unavailable; retrying within the deadline.");
      await pause();
      continue;
    }
    if (now() >= deadline) break;
    if ([401, 403].includes(response.status)) {
      throw new Error(`Vercel deployment query authorization failed (HTTP ${response.status}). Check token access to this project/team.`);
    }
    if (!response.ok) {
      lastQuery = `HTTP ${response.status}`;
      if (response.status !== 404 && response.status !== 429 && response.status < 500) {
        throw new Error(`Vercel deployment query failed (HTTP ${response.status}).`);
      }
      log(`Vercel deployment query returned HTTP ${response.status}; retrying within the deadline.`);
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
      const date = retryAfter ? Date.parse(retryAfter) : NaN;
      const wait = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now() : 0;
      await pause(Math.max(pollIntervalMs, wait));
      continue;
    }
    lastQuery = "HTTP 200";
    if (!data || typeof data !== "object" || !/^dpl_[a-zA-Z0-9]+$/.test(data.id || "") ||
      (!pendingStates.has(data.readyState) && !failedStates.has(data.readyState))) {
      lastQuery = "invalid deployment response";
      log("Vercel returned an unrecognized deployment response; retrying within the deadline.");
      await pause();
      continue;
    }
    if (reference.startsWith("dpl_") && data.id !== reference) {
      throw new Error("Vercel returned a different deployment ID.");
    }
    let responseHost;
    try { responseHost = deploymentReference(data.url); } catch {
      throw new Error("Vercel returned an invalid deployment URL.");
    }
    if (responseHost.startsWith("dpl_")) {
      throw new Error("Vercel returned an invalid deployment URL.");
    }
    if (!reference.startsWith("dpl_") && responseHost !== reference) {
      throw new Error("Vercel returned a different deployment URL.");
    }
    const state = data.readyState;
    lastState = state;
    const progress = `${state}; production domains ${data.aliasAssigned === true ? "assigned" : "pending"}`;
    if (progress !== previousProgress) {
      log(`Vercel deployment: ${progress}.`);
      previousProgress = progress;
    }
    if (failedStates.has(state) || data.errorCode) {
      throw new Error(`Vercel deployment failed in state ${state}${safeCode(data.errorCode, token)}. See the deployment dashboard for details.`);
    }
    if (data.aliasError) {
      throw new Error(`Vercel production domain assignment failed${safeCode(data.aliasError.code, token)}. See the deployment dashboard for details.`);
    }
    if (state === "READY" && data.aliasAssigned === true) {
      const projectIds = [data.projectId, data.project?.id].filter(Boolean);
      if (expectedProjectId && (!projectIds.length || projectIds.some((id) => id !== expectedProjectId))) {
        throw new Error("Vercel deployment project does not match the expected project.");
      }
      const shas = [data.meta?.githubCommitSha, data.gitSource?.sha].filter(Boolean);
      if (expectedSha && (!shas.length || shas.some((sha) => sha !== expectedSha))) {
        throw new Error("Vercel deployment commit does not match the expected source commit.");
      }
      return { id: data.id, url: responseHost, readyState: state, aliasAssigned: true };
    }
    await pause();
  }
  throw new Error(`Timed out waiting for Vercel deployment readiness after ${timeoutMs}ms. Last state: ${lastState}; last query: ${lastQuery}. Deployment completion could not be verified.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || !process.env.VERCEL_PROJECT_ID || !process.env.GITHUB_SHA) {
      throw new Error("Usage: node scripts/wait-for-vercel.mjs <deployment URL or ID>; VERCEL_PROJECT_ID and GITHUB_SHA are required.");
    }
    const result = await waitForDeployment({
      deployment: process.argv[2],
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      expectedProjectId: process.env.VERCEL_PROJECT_ID,
      expectedSha: process.env.GITHUB_SHA,
    });
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      "\nState: READY; production domains assigned; project and source commit verified.\n");
  } catch (error) {
    console.error(`Vercel deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
