import "server-only";
import { akahuMode, env } from "@/lib/env";
import { LiveAkahuClient } from "./live";
import { MockAkahuClient } from "./mock";
import type { AkahuClient } from "./types";

export function getAkahuClient(): AkahuClient {
  return akahuMode() === "live"
    ? new LiveAkahuClient(env.akahuAppToken!, env.akahuUserToken!)
    : new MockAkahuClient();
}
