"use client";

import { useState, useTransition } from "react";
import { sendMagicLink, verifyCode } from "./actions";

/**
 * Step 1: email → we send a code and a link. Step 2: type the code here.
 * The code signs you in right here (handy in the home-screen app, where the
 * email link would open in a different browser).
 */
export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  if (!sent) {
    return (
      <form
        className="mt-6 space-y-3"
        action={(fd) =>
          start(async () => {
            const r = await sendMagicLink(fd);
            setMsg(r);
            if (r.ok) setSent(true);
          })
        }
      >
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="input w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "Sending…" : "Email me a code"}
        </button>
        {msg && !msg.ok && <p className="text-sm text-danger">{msg.message}</p>}
      </form>
    );
  }

  return (
    <form
      className="mt-6 space-y-3"
      action={(fd) =>
        start(async () => {
          // On success the server redirects to the app.
          setMsg(await verifyCode(fd));
        })
      }
    >
      <p className="text-sm text-muted">{msg?.ok ? msg.message : `Sent to ${email}.`}</p>
      <input type="hidden" name="email" value={email} />
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,12}"
        maxLength={12}
        required
        autoFocus
        placeholder="123456"
        aria-label="Code from the email"
        className="input w-full text-center text-2xl tracking-[0.4em]"
      />
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      {msg && !msg.ok && <p className="text-sm text-danger">{msg.message}</p>}
      <button
        type="button"
        className="w-full text-center text-sm text-muted underline"
        onClick={() => {
          setSent(false);
          setMsg(null);
        }}
      >
        Use a different email or send a new code
      </button>
    </form>
  );
}
