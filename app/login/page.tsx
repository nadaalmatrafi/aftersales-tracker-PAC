import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-1 w-10 rounded bg-accent" />
          <h1 className="text-lg font-semibold tracking-tight">Business Performance</h1>
          <p className="mt-1 text-xs tracking-widest text-muted">PAC · PCVC · DEX</p>
        </div>
        <div className="card p-6">
          <LoginForm next={sp.next} />
          {sp.error === "sso" && <p className="mt-3 text-sm text-[#ff7b82]">EPMS sign-in could not be verified. Use your email and password.</p>}
        </div>
        <p className="mt-4 text-center text-xs text-muted">Access is limited to authorized PAC, PCVC and DEX personnel.</p>
      </div>
    </main>
  );
}
