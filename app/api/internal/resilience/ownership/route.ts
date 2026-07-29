import { NextRequest } from "next/server";
import {
  getGoldenFlagAdminCredential,
  GoldenFlagAdminUnavailable,
} from "@/lib/golden-flag-admin";
import {
  configuredScenarioTargetOrigin,
  createOwnershipResponseProof,
  ownershipRequestMatches,
  parseOwnershipRequest,
  SCENARIO_TARGET_PROOF_HEADER,
  SCENARIO_TARGET_REQUEST_HEADER,
} from "@/lib/scenario-target-contract";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const request = parseOwnershipRequest(body);
  if (!request) return new Response(null, { status: 400 });
  try {
    const secret = getGoldenFlagAdminCredential();
    const origin = configuredScenarioTargetOrigin();
    if (
      !ownershipRequestMatches({
        secret,
        origin,
        request,
        received: req.headers.get(SCENARIO_TARGET_REQUEST_HEADER),
      })
    ) {
      return new Response(null, { status: 401 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        [SCENARIO_TARGET_PROOF_HEADER]: createOwnershipResponseProof({
          secret,
          origin,
          request,
        }),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof GoldenFlagAdminUnavailable) {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 500 });
  }
}
