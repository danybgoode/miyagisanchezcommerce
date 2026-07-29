import { createHmac, timingSafeEqual } from "node:crypto";

type ProbeCredentialStatus = "active" | "revoked";
type ProbeCredentialResolution = "active" | "revoked" | "unknown";

function deriveToken(secret: string, status: ProbeCredentialStatus): string {
  return createHmac("sha256", secret)
    .update(`miyagi-scenario-probe-credential-v1\n${status}`, "utf8")
    .digest("hex");
}

function hashToken(secret: string, token: string): Buffer {
  return createHmac("sha256", secret)
    .update(`miyagi-scenario-probe-lookup-v1\n${token}`, "utf8")
    .digest();
}

export function resolveProbeCredential(
  secret: string,
  candidate: string,
): ProbeCredentialResolution {
  const candidateHash = hashToken(secret, candidate);
  const registry: Array<{
    hash: Buffer;
    status: ProbeCredentialStatus;
  }> = [
    {
      hash: hashToken(secret, deriveToken(secret, "active")),
      status: "active",
    },
    {
      hash: hashToken(secret, deriveToken(secret, "revoked")),
      status: "revoked",
    },
  ];
  for (const entry of registry) {
    if (timingSafeEqual(candidateHash, entry.hash)) return entry.status;
  }
  return "unknown";
}

export function exerciseProbeCredentialTemplate(
  secret: string,
  template: "invalid_credential_v1" | "revoked_credential_v1",
): 401 | 403 {
  const candidate =
    template === "revoked_credential_v1"
      ? deriveToken(secret, "revoked")
      : "miyagi-probe-deliberately-invalid-v1";
  return resolveProbeCredential(secret, candidate) === "revoked" ? 403 : 401;
}

export function activeProbeCredentialIsAccepted(secret: string): boolean {
  return (
    resolveProbeCredential(secret, deriveToken(secret, "active")) === "active"
  );
}
