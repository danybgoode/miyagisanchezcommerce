import "server-only";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

export async function checkScenarioProbeRateLimit(
  identifier: string,
): Promise<"allowed" | "limited" | "unavailable"> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return "unavailable";
  try {
    const limiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(2, "1 m"),
      prefix: "rl:scenario_probe_v1",
    });
    const result = await limiter.limit(identifier);
    return result.success ? "allowed" : "limited";
  } catch {
    // A defensive proof must not claim a rate-limit success when its backing
    // store is unavailable.
    return "unavailable";
  }
}
