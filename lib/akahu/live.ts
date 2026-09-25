import "server-only";
import type {
  AkahuAccount,
  AkahuClient,
  AkahuPage,
  AkahuPendingTransaction,
  AkahuTransaction,
} from "./types";

const BASE = "https://api.akahu.io/v1";
const MAX_ATTEMPTS = 5;
const MAX_WAIT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** Token/permission problems: shown verbatim on the sync status. */
export class AkahuAuthError extends Error {
  constructor(status: number, detail?: string) {
    super(
      status === 401
        ? `Akahu rejected the tokens (401${detail ? `: ${detail}` : ""}). Check AKAHU_APP_TOKEN and AKAHU_USER_TOKEN — user tokens stop working if you revoke access or re-create the app at my.akahu.nz/developers.`
        : `Akahu denied access (403${detail ? `: ${detail}` : ""}). Your personal app may be missing permission for this account — re-connect it at my.akahu.nz.`,
    );
    this.name = "AkahuAuthError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Retry-After can be seconds or an HTTP date. */
function retryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Real Akahu personal-app client. Tokens never leave the server. */
export class LiveAkahuClient implements AkahuClient {
  readonly mode = "live" as const;
  constructor(
    private appToken: string,
    private userToken: string,
    private fetchImpl: typeof fetch = fetch,
    private wait: (ms: number) => Promise<void> = sleep,
  ) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<AkahuPage<T>> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    let lastError = "";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: {
            "X-Akahu-Id": this.appToken,
            Authorization: `Bearer ${this.userToken}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        // Network error / timeout: back off and retry.
        lastError = err instanceof Error ? err.message : String(err);
        await this.wait(Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        const hinted = retryAfterMs(res.headers.get("retry-after"));
        const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
        await this.wait(Math.min(MAX_WAIT_MS, hinted ?? backoff));
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as AkahuPage<T> & { message?: string };
      if (res.status === 401 || res.status === 403) throw new AkahuAuthError(res.status, body.message);
      if (!res.ok || body.success === false) {
        throw new Error(`Akahu ${path} failed (${res.status}): ${body.message ?? res.statusText}`);
      }
      if (!Array.isArray(body.items)) throw new Error(`Akahu ${path} returned an unexpected response`);
      return body;
    }
    throw new Error(`Akahu ${path} still failing after ${MAX_ATTEMPTS} attempts (${lastError}). Rate limited or down — try again later.`);
  }

  async listAccounts(): Promise<AkahuAccount[]> {
    return (await this.get<AkahuAccount>("/accounts")).items;
  }

  async listTransactions(startIso: string, endIso: string): Promise<AkahuTransaction[]> {
    const out: AkahuTransaction[] = [];
    let cursor: string | null | undefined;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const params: Record<string, string> = { start: startIso, end: endIso };
      if (cursor) params.cursor = cursor;
      const page = await this.get<AkahuTransaction>("/transactions", params);
      out.push(...page.items);
      cursor = page.cursor?.next;
      if (!cursor) return out;
      if (seen.has(cursor)) throw new Error("Akahu pagination looped (repeated cursor)");
      seen.add(cursor);
    }
    throw new Error("Akahu pagination did not finish");
  }

  async listPendingTransactions(): Promise<AkahuPendingTransaction[]> {
    return (await this.get<AkahuPendingTransaction>("/transactions/pending")).items;
  }
}
