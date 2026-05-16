import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

const COOKIE_NAME = "personalcloud_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  issuedAt: number;
  expiresAt: number;
};

export async function hasValidSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return Boolean(value && verifySessionValue(value));
}

export async function setSessionCookie(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS,
  };
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, signPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signPayload(payload: SessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySessionValue(value: string): boolean {
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  if (!safeCompare(hmac(encodedPayload), signature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString()) as SessionPayload;
    return Number.isInteger(payload.expiresAt) && payload.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function hmac(value: string): string {
  return crypto.createHmac("sha256", requireEnv("PERSONALCLOUD_SESSION_SECRET")).update(value).digest("base64url");
}
