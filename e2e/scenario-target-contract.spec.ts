import { expect, test } from "@playwright/test";
import {
  activeProbeCredentialIsAccepted,
  exerciseProbeCredentialTemplate,
  resolveProbeCredential,
} from "../lib/scenario-probe-credentials";
import {
  configuredScenarioTargetOrigin,
  createOwnershipResponseProof,
  MIYAGI_SCENARIO_TARGET_KEY,
  ownershipRequestMatches,
  parseOwnershipRequest,
  parseSecurityProbeRequest,
  securityProbeRequestMatches,
} from "../lib/scenario-target-contract";

const SECRET = "fixture-secret-with-enough-entropy";
const ORIGIN = "https://miyagisanchez.com";
const OWNERSHIP = {
  contractVersion: 1 as const,
  challenge: "a".repeat(64),
  targetKey: MIYAGI_SCENARIO_TARGET_KEY,
} as const;
const SECURITY = {
  contractVersion: 1 as const,
  runId: "11111111-1111-4111-8111-111111111111",
  leaseId: "22222222-2222-4222-8222-222222222222",
  runRevision: 4,
  targetKey: MIYAGI_SCENARIO_TARGET_KEY,
  template: "revoked_credential_v1" as const,
  attempt: 1,
} as const;

test("ownership handshake matches Golden vectors and rejects caller-added fields", () => {
  expect(parseOwnershipRequest(OWNERSHIP)).toEqual(OWNERSHIP);
  expect(
    parseOwnershipRequest({ ...OWNERSHIP, origin: "https://attacker.example" }),
  ).toBeNull();
  expect(
    ownershipRequestMatches({
      secret: SECRET,
      origin: ORIGIN,
      request: OWNERSHIP,
      received:
        "e16fd46268fe1f7b90e16f8fa48631e8f4781378d0e0954523a25ae7938d63c8",
    }),
  ).toBe(true);
  expect(
    createOwnershipResponseProof({
      secret: SECRET,
      origin: ORIGIN,
      request: OWNERSHIP,
    }),
  ).toBe("f0e673f447feb236c4bffdfef41f60341d8a0579d21a1b2cfe917f132d0ba958");
});

test("security probe matches Golden vector and has no arbitrary execution inputs", () => {
  expect(parseSecurityProbeRequest(SECURITY)).toEqual(SECURITY);
  for (const added of [
    { url: "https://attacker.example" },
    { credential: "caller-selected" },
    { headers: { authorization: "secret" } },
    { body: "caller-selected" },
  ]) {
    expect(parseSecurityProbeRequest({ ...SECURITY, ...added })).toBeNull();
  }
  expect(
    securityProbeRequestMatches({
      secret: SECRET,
      origin: ORIGIN,
      request: SECURITY,
      received:
        "4daf1091bf79a03119fc7b00531f7b7bb47c87b8a259d36b71ad99c63cd4b97d",
    }),
  ).toBe(true);
});

test("configured target origin never falls back to a request Host", () => {
  expect(configuredScenarioTargetOrigin(undefined)).toBe(ORIGIN);
  expect(configuredScenarioTargetOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
  for (const invalid of [
    "http://miyagisanchez.com",
    "https://miyagisanchez.com/path",
    "https://user:pass@miyagisanchez.com",
  ]) {
    expect(() => configuredScenarioTargetOrigin(invalid)).toThrow();
  }
});

test("revoked fixture matches identity and is rejected solely by stored status", () => {
  expect(activeProbeCredentialIsAccepted(SECRET)).toBe(true);
  expect(exerciseProbeCredentialTemplate(SECRET, "invalid_credential_v1")).toBe(
    401,
  );
  expect(exerciseProbeCredentialTemplate(SECRET, "revoked_credential_v1")).toBe(
    403,
  );
  expect(resolveProbeCredential(SECRET, "unregistered")).toBe("unknown");
});
