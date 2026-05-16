import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { hasValidSession } from "@/lib/session";

export default async function LoginPage() {
  if (await hasValidSession()) {
    redirect("/files");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-ink/10 bg-white p-6 shadow-panel">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-moss">PersonalCloud</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Storage login</h1>
          <p className="mt-3 text-sm leading-6 text-ink/65">
            Access is limited to the admin login token configured on this machine.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
