import "server-only";

import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/session";
import { requireEnv } from "@/lib/env";

export async function requireRouteSession(): Promise<NextResponse | null> {
  if (await hasValidSession()) {
    return null;
  }

  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

export function storageUrl(pathname: string, params?: URLSearchParams): string {
  const base = requireEnv("PERSONALCLOUD_STORAGE_API_URL").replace(/\/$/, "");
  const suffix = params ? `${pathname}?${params.toString()}` : pathname;
  return `${base}${suffix}`;
}

export function storageHeaders(extra?: HeadersInit): HeadersInit {
  return {
    ...extra,
    "X-PersonalCloud-Token": requireEnv("PERSONALCLOUD_INTERNAL_API_TOKEN"),
  };
}

export async function proxyJson(response: Response): Promise<NextResponse> {
  const data = await response.json().catch(() => ({ detail: "Storage service returned an invalid response" }));

  if (!response.ok) {
    return NextResponse.json({ error: normalizeError(data) }, { status: response.status });
  }

  return NextResponse.json(data, { status: response.status });
}

export function normalizeError(data: unknown): string {
  if (typeof data === "object" && data !== null && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
  }

  if (typeof data === "object" && data !== null && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
  }

  return "Storage request failed";
}
