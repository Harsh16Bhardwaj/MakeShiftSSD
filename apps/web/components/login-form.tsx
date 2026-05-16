"use client";

import { FormEvent, useState } from "react";
import { Lock, LogIn } from "lucide-react";

export function LoginForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Login failed");
        setIsSubmitting(false);
        return;
      }

      window.location.assign("/files");
    } catch {
      setError("Could not reach the login service");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <label className="block">
        <span className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Admin token
        </span>
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/20"
          placeholder="Enter token"
          required
        />
      </label>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/45"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {isSubmitting ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
