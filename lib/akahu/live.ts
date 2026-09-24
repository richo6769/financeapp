import "server-only";
import type {
  AkahuAccount,
  AkahuClient,
  AkahuPage,
  AkahuPendingTransaction,
  AkahuTransaction,
} from "./types";

const BASE = "https://api.akahu.io/v1";

/** Real Akahu personal-app client. Tokens never leave the server. */
export class LiveAkahuClient implements AkahuClient {
  readonly mode = "live" as const;
  constructor(
    private appToken: string,
    private userToken: string,
  ) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<AkahuPage<T>> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        headers: {
          "X-Akahu-Id": this.appToken,
          Authorization: `Bearer ${this.userToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as AkahuPage<T> & { message?: string };
      if (!res.ok || body.success === false) {
        throw new Error(`Akahu ${path} failed (${res.status}): ${body.message ?? res.statusText}`);
      }
      return body;
    }
    throw new Error(`Akahu ${path} failed after retries`);
  }

  async listAccounts(): Promise<AkahuAccount[]> {
    return (await this.get<AkahuAccount>("/accounts")).items;
  }

  async listTransactions(startIso: string, endIso: string): Promise<AkahuTransaction[]> {
    const out: AkahuTransaction[] = [];
    let cursor: string | null | undefined;
    for (let i = 0; i < 500; i++) {
      const params: Record<string, string> = { start: startIso, end: endIso };
      if (cursor) params.cursor = cursor;
      const page = await this.get<AkahuTransaction>("/transactions", params);
      out.push(...page.items);
      cursor = page.cursor?.next;
      if (!cursor) break;
    }
    return out;
  }

  async listPendingTransactions(): Promise<AkahuPendingTransaction[]> {
    return (await this.get<AkahuPendingTransaction>("/transactions/pending")).items;
  }
}
