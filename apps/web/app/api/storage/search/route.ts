import { NextRequest } from "next/server";
import { proxyJson, requireRouteSession, storageHeaders, storageUrl } from "@/lib/storage-api";

export async function GET(request: NextRequest) {
  const unauthorized = await requireRouteSession();
  if (unauthorized) return unauthorized;

  const params = new URLSearchParams({
    query: request.nextUrl.searchParams.get("query") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? "80",
  });
  const response = await fetch(storageUrl("/api/files/search", params), {
    headers: storageHeaders(),
    cache: "no-store",
  });

  return proxyJson(response);
}
