import { NextResponse } from "next/server";
import { integrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Which integrations are live vs mock (no secrets are returned). */
export const GET = () => NextResponse.json(integrationStatus());
