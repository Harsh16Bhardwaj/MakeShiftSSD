import { NextRequest, NextResponse } from "next/server";
import { normalizeError, requireRouteSession, storageHeaders, storageUrl } from "@/lib/storage-api";

export async function GET(request: NextRequest) {
  const unauthorized = await requireRouteSession();
  if (unauthorized) return unauthorized;

  const params = new URLSearchParams({
    path: request.nextUrl.searchParams.get("path") ?? "",
  });
  const response = await fetch(storageUrl("/api/files/preview", params), {
    headers: storageHeaders(),
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({ detail: "Preview failed" }));
    return NextResponse.json({ error: normalizeError(data) }, { status: response.status });
  }

  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const contentLength = response.headers.get("content-length");
  const contentDisposition = response.headers.get("content-disposition");
  const contentOptions = response.headers.get("x-content-type-options");

  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  if (contentDisposition) headers.set("content-disposition", contentDisposition);
  if (contentOptions) headers.set("x-content-type-options", contentOptions);

  return new NextResponse(response.body, { status: response.status, headers });
}
