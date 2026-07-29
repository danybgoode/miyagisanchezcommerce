import "server-only";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

let cachedLimiter:
  | {
      url: string;
      token: string;
      limiter: Ratelimit;
    }
  | undefined;

function getLimiter(url: string, token: string): Ratelimit {
  if (
    !cachedLimiter ||
    cachedLimiter.url !== url ||
    cachedLimiter.token !== token
  ) {
    cachedLimiter = {
      url,
      token,
      limiter: new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(2, "1 m"),
        prefix: "rl:scenario_probe_v1",
      }),
    };
  }
  return cachedLimiter.limiter;
}

export async function checkScenarioProbeRateLimit(
  identifier: string,
): Promise<"allowed" | "limited" | "unavailable"> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return "unavailable";
  try {
    const result = await getLimiter(url, token).limit(identifier);
    return result.success ? "allowed" : "limited";
  } catch {
    // A defensive proof must not claim a rate-limit success when its backing
    // store is unavailable.
    return "unavailable";
  }
}
