import { NextRequest } from "next/server";
import { proxyJson, requireRouteSession, storageHeaders, storageUrl } from "@/lib/storage-api";

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireRouteSession();
  if (unauthorized) return unauthorized;

  const params = new URLSearchParams({
    path: request.nextUrl.searchParams.get("path") ?? "",
  });
  const response = await fetch(storageUrl("/api/files", params), {
    method: "DELETE",
    headers: storageHeaders(),
  });

  return proxyJson(response);
}
