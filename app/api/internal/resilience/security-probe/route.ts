import { NextRequest } from "next/server";
import {
  getGoldenFlagAdminCredential,
  GoldenFlagAdminUnavailable,
} from "@/lib/golden-flag-admin";
import {
  configuredScenarioTargetOrigin,
  parseSecurityProbeRequest,
  SCENARIO_SECURITY_REQUEST_HEADER,
  securityProbeRequestMatches,
} from "@/lib/scenario-target-contract";
import { exerciseProbeCredentialTemplate } from "@/lib/scenario-probe-credentials";
import { checkScenarioProbeRateLimit } from "@/lib/scenario-probe-rate-limit";

function empty(status: number) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return empty(400);
  }
  const request = parseSecurityProbeRequest(body);
  if (!request) return empty(400);

  try {
    const secret = getGoldenFlagAdminCredential();
    const origin = configuredScenarioTargetOrigin();
    if (
      !securityProbeRequestMatches({
        secret,
        origin,
        request,
        received: req.headers.get(SCENARIO_SECURITY_REQUEST_HEADER),
      })
    ) {
      return empty(401);
    }

    if (request.template === "malformed_payload_v1") {
      // Exercise the strict parser with a closed, server-owned malformed object.
      return parseSecurityProbeRequest({
        contractVersion: 1,
        unexpected: "closed-malformed-fixture",
      })
        ? empty(500)
        : empty(400);
    }
    if (
      request.template === "invalid_credential_v1" ||
      request.template === "revoked_credential_v1"
    ) {
      return empty(exerciseProbeCredentialTemplate(secret, request.template));
    }

    const rate = await checkScenarioProbeRateLimit(
      `${request.runId}:${request.leaseId}`,
    );
    if (rate === "unavailable") return empty(503);
    return rate === "limited" ? empty(429) : empty(204);
  } catch (error) {
    if (error instanceof GoldenFlagAdminUnavailable) return empty(503);
    return empty(500);
  }
}
