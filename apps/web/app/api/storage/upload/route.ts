import { NextRequest } from "next/server";
import { proxyJson, requireRouteSession, storageHeaders, storageUrl } from "@/lib/storage-api";

export async function POST(request: NextRequest) {
  const unauthorized = await requireRouteSession();
  if (unauthorized) return unauthorized;

  const formData = await request.formData();
  const response = await fetch(storageUrl("/api/files/upload"), {
    method: "POST",
    headers: storageHeaders(),
    body: formData,
  });

  return proxyJson(response);
}
