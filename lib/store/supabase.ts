import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TableName, Tables } from "@/lib/types";
import type { Filter, NewRow, SelectOptions, Store } from "./types";

const PAGE = 1000; // PostgREST default max rows per request
const IN_CHUNK = 150; // keep `in.(...)` filters well under URL length limits

/* eslint-disable @typescript-eslint/no-explicit-any */
type Q = any;

function applyFilter<T>(q: Q, filter: Filter<T> | undefined, userId: string): Q {
  q = q.eq("user_id", userId);
  if (!filter) return q;
  for (const [k, val] of Object.entries(filter.eq ?? {})) {
    q = val === null ? q.is(k, null) : q.eq(k, val);
  }
  for (const [k, vals] of Object.entries(filter.in ?? {})) q = q.in(k, vals as unknown[]);
  for (const [k, val] of Object.entries(filter.gte ?? {})) q = q.gte(k, val);
  for (const [k, val] of Object.entries(filter.lte ?? {})) q = q.lte(k, val);
  return q;
}

/** Split a filter with a large `in` list into several smaller filters. */
function chunkFilter<T>(filter?: Filter<T>): (Filter<T> | undefined)[] {
  const entries = Object.entries(filter?.in ?? {}) as [string, unknown[]][];
  const big = entries.find(([, vals]) => vals.length > IN_CHUNK);
  if (!big) return [filter];
  const [key, vals] = big;
  const out: Filter<T>[] = [];
  for (let i = 0; i < vals.length; i += IN_CHUNK) {
    out.push({ ...filter, in: { ...filter!.in, [key]: vals.slice(i, i + IN_CHUNK) } } as Filter<T>);
  }
  return out;
}

function check<T>(res: { data: T; error: { message: string } | null }, ctx: string): T {
  if (res.error) throw new Error(`Supabase ${ctx}: ${res.error.message}`);
  return res.data;
}

/**
 * Supabase-backed store. Used with either the logged-in user's cookie client
 * (RLS enforces ownership) or the service-role client for cron jobs (we still
 * filter/write user_id explicitly).
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  constructor(
    private sb: SupabaseClient,
    readonly userId: string,
  ) {}

  async select<K extends TableName>(
    table: K,
    filter?: Filter<Tables[K]>,
    opts?: SelectOptions<Tables[K]>,
  ): Promise<Tables[K][]> {
    const all: Tables[K][] = [];
    for (const f of chunkFilter(filter)) {
      for (let from = 0; ; from += PAGE) {
        let q: Q = this.sb.from(table).select("*");
        q = applyFilter(q, f, this.userId);
        if (opts?.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
        else if (table !== "settings") q = q.order("id");
        const to = opts?.limit ? Math.min(from + PAGE, opts.limit) - 1 : from + PAGE - 1;
        const data = check(await q.range(from, to), `select ${table}`) as Tables[K][];
        all.push(...data);
        if (data.length < to - from + 1 || (opts?.limit && all.length >= opts.limit)) break;
      }
    }
    return opts?.limit ? all.slice(0, opts.limit) : all;
  }

  async insert<K extends TableName>(table: K, rows: NewRow<Tables[K]>[]): Promise<Tables[K][]> {
    if (!rows.length) return [];
    const payload = rows.map((r) => ({ ...r, user_id: this.userId }));
    return check(await this.sb.from(table).insert(payload).select("*"), `insert ${table}`) as Tables[K][];
  }

  async upsert<K extends TableName>(
    table: K,
    rows: (NewRow<Tables[K]> & { id?: string })[],
    onConflict: string,
  ): Promise<Tables[K][]> {
    const out: Tables[K][] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const payload = rows.slice(i, i + 500).map((r) => ({ ...r, user_id: this.userId }));
      const data = check(
        await this.sb.from(table).upsert(payload, { onConflict }).select("*"),
        `upsert ${table}`,
      ) as Tables[K][];
      out.push(...data);
    }
    return out;
  }

  async update<K extends TableName>(
    table: K,
    filter: Filter<Tables[K]>,
    patch: Partial<Tables[K]>,
  ): Promise<number> {
    let n = 0;
    const { user_id: _ignored, ...safePatch } = patch as Record<string, unknown>;
    void _ignored;
    for (const f of chunkFilter(filter)) {
      let q: Q = this.sb.from(table).update(safePatch);
      q = applyFilter(q, f, this.userId);
      const data = check(await q.select(table === "settings" ? "user_id" : "id"), `update ${table}`);
      n += (data as unknown[]).length;
    }
    return n;
  }

  async remove<K extends TableName>(table: K, filter: Filter<Tables[K]>): Promise<number> {
    let n = 0;
    for (const f of chunkFilter(filter)) {
      let q: Q = this.sb.from(table).delete();
      q = applyFilter(q, f, this.userId);
      const data = check(await q.select(table === "settings" ? "user_id" : "id"), `delete ${table}`);
      n += (data as unknown[]).length;
    }
    return n;
  }
}
