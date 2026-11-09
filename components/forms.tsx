"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form-state";

const Pending = createContext(false);

export function SubmitButton({ children, className = "btn btn-primary", pendingText, confirm }: { children: ReactNode; className?: string; pendingText?: string; confirm?: string }) {
  const { pending: nativePending } = useFormStatus();
  const pending = useContext(Pending) || nativePending;
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

/**
 * Form bound to a server action returning FormState; shows the result inline.
 * Submits via onSubmit (not the `action` prop) so React does not clear the fields when the server
 * returns an error — the person fixes the one thing named in the message instead of re-typing everything.
 * On success the form resets only when resetOnSuccess is true.
 */
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
  const [state, formAction, pending] = useActionState(action, { ok: false } as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <Pending.Provider value={pending}>{children}</Pending.Provider>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-accent">
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
