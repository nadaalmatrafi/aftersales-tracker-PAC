"use client";
import { useActionState } from "react";
import { loginAction } from "./actions";
import { SubmitButton } from "@/components/forms";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, { ok: false });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="label">Work email</span>
        <input className="input" name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p role="alert" className="text-sm text-[#ff7b82]">{state.error}</p>}
      <SubmitButton className="btn btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
