import { NextRequest } from "next/server";
import { proxyJson, requireRouteSession, storageHeaders, storageUrl } from "@/lib/storage-api";

export async function POST(request: NextRequest) {
  const unauthorized = await requireRouteSession();
  if (unauthorized) return unauthorized;

  const body = await request.text();
  const response = await fetch(storageUrl("/api/files/move"), {
    method: "POST",
    headers: storageHeaders({ "Content-Type": "application/json" }),
    body,
  });

  return proxyJson(response);
}
