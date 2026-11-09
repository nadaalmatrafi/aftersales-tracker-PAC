"use client";

import { useState } from "react";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";

const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|gif|txt|csv|docx?|xlsx?|pptx?|zip)$/i;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip";
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** File picker that checks size and type before upload and explains exactly what is wrong. */
export function FileInput({ name = "file", label = "File", className = "", required = true }: { name?: string; label?: string; className?: string; required?: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className={className}>
      <input
        type="file"
        name={name}
        required={required}
        accept={ACCEPT}
        aria-label={label}
        aria-describedby={`${name}-hint`}
        className="block w-full text-xs text-fg-2 file:mr-3 file:rounded file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-fg"
        onChange={(e) => {
          const el = e.currentTarget;
          const f = el.files?.[0];
          let err = "";
          if (f && f.size === 0) err = `“${f.name}” is empty.`;
          else if (f && f.size > MAX_ATTACHMENT_BYTES) err = `“${f.name}” is ${mb(f.size)}. The limit is ${mb(MAX_ATTACHMENT_BYTES)} — compress it or split it into smaller files.`;
          else if (f && !ALLOWED_EXT.test(f.name)) err = `“${f.name}” is not a supported file type. Use PDF, Word, Excel, PowerPoint, images, CSV, text or ZIP.`;
          el.setCustomValidity(err);
          setMsg(f ? (err ? { ok: false, text: err } : { ok: true, text: `Ready to upload: ${f.name} (${mb(f.size)})` }) : null);
        }}
      />
      <p id={`${name}-hint`} role={msg && !msg.ok ? "alert" : undefined} className={`mt-1 text-xs ${msg ? (msg.ok ? "text-ok" : "text-accent") : "text-muted"}`}>
        {msg ? msg.text : `PDF, Office, images, CSV, text or ZIP · max ${mb(MAX_ATTACHMENT_BYTES)}`}
      </p>
    </div>
  );
}
