"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form-state";

export function SubmitButton({ children, className = "btn btn-primary", pendingText, confirm }: { children: ReactNode; className?: string; pendingText?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

/** Form bound to a server action returning FormState; shows the result inline and resets on success. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false } as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-[#ff7b82]">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="mt-2 text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
