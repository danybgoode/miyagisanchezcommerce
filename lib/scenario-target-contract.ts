import { createHmac, timingSafeEqual } from "node:crypto";

export const MIYAGI_SCENARIO_TARGET_KEY = "miyagi.internal.probe";
export const SCENARIO_TARGET_REQUEST_HEADER =
  "x-golden-beans-ownership-request";
export const SCENARIO_TARGET_PROOF_HEADER = "x-golden-beans-ownership-proof";
export const SCENARIO_SECURITY_REQUEST_HEADER =
  "x-golden-beans-scenario-request";

const HEX_64 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURITY_TEMPLATES = new Set([
  "malformed_payload_v1",
  "rate_limit_v1",
  "invalid_credential_v1",
  "revoked_credential_v1",
]);

export type OwnershipRequest = {
  contractVersion: 1;
  challenge: string;
  targetKey: typeof MIYAGI_SCENARIO_TARGET_KEY;
};

export type SecurityProbeRequest = {
  contractVersion: 1;
  runId: string;
  leaseId: string;
  runRevision: number;
  targetKey: typeof MIYAGI_SCENARIO_TARGET_KEY;
  template:
    | "malformed_payload_v1"
    | "rate_limit_v1"
    | "invalid_credential_v1"
    | "revoked_credential_v1";
  attempt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function configuredScenarioTargetOrigin(
  configured = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const candidate = (configured ?? "https://miyagisanchez.com").replace(
    /\/+$/,
    "",
  );
  const url = new URL(candidate);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== candidate
  ) {
    throw new Error("Scenario target origin must be an exact HTTPS origin");
  }
  return candidate;
}

export function parseOwnershipRequest(value: unknown): OwnershipRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["contractVersion", "challenge", "targetKey"]) ||
    value.contractVersion !== 1 ||
    typeof value.challenge !== "string" ||
    !HEX_64.test(value.challenge) ||
    value.targetKey !== MIYAGI_SCENARIO_TARGET_KEY
  ) {
    return null;
  }
  return {
    contractVersion: 1,
    challenge: value.challenge,
    targetKey: MIYAGI_SCENARIO_TARGET_KEY,
  };
}

export function parseSecurityProbeRequest(
  value: unknown,
): SecurityProbeRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "contractVersion",
      "runId",
      "leaseId",
      "runRevision",
      "targetKey",
      "template",
      "attempt",
    ]) ||
    value.contractVersion !== 1 ||
    typeof value.runId !== "string" ||
    !UUID.test(value.runId) ||
    typeof value.leaseId !== "string" ||
    !UUID.test(value.leaseId) ||
    !Number.isSafeInteger(value.runRevision) ||
    Number(value.runRevision) < 1 ||
    value.targetKey !== MIYAGI_SCENARIO_TARGET_KEY ||
    typeof value.template !== "string" ||
    !SECURITY_TEMPLATES.has(value.template) ||
    !Number.isSafeInteger(value.attempt) ||
    Number(value.attempt) < 1 ||
    Number(value.attempt) > 3
  ) {
    return null;
  }
  return {
    contractVersion: 1,
    runId: value.runId,
    leaseId: value.leaseId,
    runRevision: Number(value.runRevision),
    targetKey: MIYAGI_SCENARIO_TARGET_KEY,
    template: value.template as SecurityProbeRequest["template"],
    attempt: Number(value.attempt),
  };
}

function hmac(secret: string, message: string): string {
  if (secret.length < 16)
    throw new Error("Scenario target secret is unavailable");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function constantTimeHexMatches(expected: string, received: unknown): boolean {
  return (
    typeof received === "string" &&
    HEX_64.test(received) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))
  );
}

function canonicalTarget(origin: string): string {
  return `${MIYAGI_SCENARIO_TARGET_KEY}\n${configuredScenarioTargetOrigin(origin)}`;
}

export function ownershipRequestMatches(input: {
  secret: string;
  origin: string;
  request: OwnershipRequest;
  received: unknown;
}): boolean {
  const expected = hmac(
    input.secret,
    [
      "golden-beans-target-request-v1",
      input.request.challenge,
      canonicalTarget(input.origin),
    ].join("\n"),
  );
  return constantTimeHexMatches(expected, input.received);
}

export function createOwnershipResponseProof(input: {
  secret: string;
  origin: string;
  request: OwnershipRequest;
}): string {
  return hmac(
    input.secret,
    [
      "golden-beans-target-response-v1",
      input.request.challenge,
      canonicalTarget(input.origin),
    ].join("\n"),
  );
}

function canonicalSecurityRequest(
  origin: string,
  request: SecurityProbeRequest,
): string {
  return [
    "golden-beans-security-request-v1",
    configuredScenarioTargetOrigin(origin),
    request.contractVersion,
    request.runId,
    request.leaseId,
    request.runRevision,
    request.targetKey,
    request.template,
    request.attempt,
  ].join("\n");
}

export function securityProbeRequestMatches(input: {
  secret: string;
  origin: string;
  request: SecurityProbeRequest;
  received: unknown;
}): boolean {
  const expected = hmac(
    input.secret,
    canonicalSecurityRequest(input.origin, input.request),
  );
  return constantTimeHexMatches(expected, input.received);
}
