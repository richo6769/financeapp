"use client";

import { useState, useTransition } from "react";
import { sendMagicLink } from "./actions";

export default function LoginForm() {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-6 space-y-3"
      action={(fd) => start(async () => setMsg(await sendMagicLink(fd)))}
    >
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="input w-full"
      />
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a link"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-danger"}`}>{msg.message}</p>}
    </form>
  );
}
