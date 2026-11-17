#!/usr/bin/env node
/**
 * `npx coss-mcp`: the coss.com MCP server over stdio. Configuration comes from the environment only
 * (never argv, which other local processes can read): COSS_API_KEY, and COSS_BASE_URL to point
 * at another API (e.g. http://localhost:3001), COSS_MCP_TOOLSETS to offer fewer tools. In CI,
 * COSS_OIDC_CREDENTIAL_ID instead of a key exchanges the job's OIDC ID token (the SDK's `oidc`).
 * With neither, a `coss_test_` key in the project's
 * `.env.local` or `.env` is used. A `coss_live_` key in that file is never loaded. Without a key
 * the server offers only the docs tools. stdout carries the protocol; logs go to stderr.
 */
import { relative } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Coss } from "coss";
import { readProjectApiKey } from "./project-env.ts";
import { createCossMcpServer, TOOLSET_NAMES } from "./server.ts";
import { parseToolsets } from "./toolsets-env.ts";

let apiKey = process.env.COSS_API_KEY?.trim();
let baseUrl = process.env.COSS_BASE_URL?.trim() || undefined;
// CI without a stored key: the SDK exchanges the job's OIDC ID token and renews the access token.
const oidcCredentialId = apiKey ? undefined : process.env.COSS_OIDC_CREDENTIAL_ID?.trim();
if (!apiKey && !oidcCredentialId) {
  const found = await readProjectApiKey(process.cwd());
  if (found.kind === "test") {
    apiKey = found.apiKey;
    if (!baseUrl && found.baseUrl) baseUrl = found.baseUrl;
    const file = relative(process.cwd(), found.file) || found.file;
    console.error(`coss-mcp: using the development key in ${file}.`);
  } else if (found.kind === "live") {
    const file = relative(process.cwd(), found.file) || found.file;
    console.error(
      `coss-mcp: ${file} has COSS_API_KEY, and it is not a development key (coss_test_). ` +
        "It was not loaded. Set COSS_API_KEY in this process to use it. Only the docs tools are available.",
    );
  } else {
    console.error(
      "coss-mcp: no COSS_API_KEY, so only the docs tools are available. Run `npx coss-cli init` in " +
        "your project for a development key, or create one in the dashboard (https://coss.com/dashboard).",
    );
  }
}

const coss = apiKey
  ? new Coss({ apiKey, baseUrl })
  : oidcCredentialId
    ? new Coss({ oidc: { credentialId: oidcCredentialId }, baseUrl })
    : undefined;

// A key's prefix says live or sandbox; an OIDC credential's environment has to be asked, or the
// sending tools couldn't warn before reaching real people.
let mode: "live" | "sandbox" | undefined;
if (coss && oidcCredentialId) {
  const { data, error } = await coss.environment.get();
  if (data) {
    mode = data.mode;
  } else {
    console.error(
      `coss-mcp: couldn't authenticate with COSS_OIDC_CREDENTIAL_ID (${error.message}). ` +
        "Tools will fail until it can.",
    );
  }
}

const { toolsets, unknown } = parseToolsets(process.env.COSS_MCP_TOOLSETS);
if (unknown.length > 0) {
  console.error(
    `coss-mcp: COSS_MCP_TOOLSETS has ${unknown.join(", ")}, which it ignores. It takes ${TOOLSET_NAMES.join(", ")}.`,
  );
}

serveStdio(() => createCossMcpServer({ coss, apiKey, mode, ...(toolsets ? { toolsets } : {}) }), {
  onerror: (error) => console.error("coss-mcp:", error),
});
