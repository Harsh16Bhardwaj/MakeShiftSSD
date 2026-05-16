import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { safeCompare, setSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token?.trim() ?? "";
  const expectedToken = requireEnv("PERSONALCLOUD_ADMIN_TOKEN");

  if (!token || !safeCompare(token, expectedToken)) {
    return NextResponse.json({ error: "Invalid admin token" }, { status: 401 });
  }

  await setSessionCookie();
  return NextResponse.json({ ok: true });
}
