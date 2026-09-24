import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TableName, Tables } from "@/lib/types";
import type { Filter, NewRow, SelectOptions, Store } from "./types";

type DB = { [K in TableName]: Tables[K][] };

const emptyDb = (): DB => ({
  accounts: [],
  transactions: [],
  pending_transactions: [],
  categories: [],
  rules: [],
  budgets: [],
  settings: [],
  chat_messages: [],
  sync_log: [],
});

/** Tables whose rows have no `id` column (keyed by user_id). */
const NO_ID: TableName[] = ["settings"];
const HAS_UPDATED_AT: TableName[] = [
  "accounts",
  "transactions",
  "pending_transactions",
  "budgets",
  "settings",
];

export function matches<T>(row: T, filter?: Filter<T>): boolean {
  if (!filter) return true;
  const r = row as Record<string, unknown>;
  for (const [k, val] of Object.entries(filter.eq ?? {})) {
    if ((r[k] ?? null) !== (val ?? null)) return false;
  }
  for (const [k, vals] of Object.entries(filter.in ?? {})) {
    if (!(vals as unknown[]).includes(r[k] as never)) return false;
  }
  for (const [k, val] of Object.entries(filter.gte ?? {})) {
    if (r[k] == null || (r[k] as string | number) < (val as string | number)) return false;
  }
  for (const [k, val] of Object.entries(filter.lte ?? {})) {
    if (r[k] == null || (r[k] as string | number) > (val as string | number)) return false;
  }
  return true;
}

/**
 * JSON-file store for demo mode (no Supabase keys). Single process, single
 * user. Data lives in .data/db.json (or /tmp on read-only hosts like Vercel).
 */
export class LocalStore implements Store {
  readonly kind = "local" as const;
  private file: string;
  private cache: { mtime: number; db: DB } | null = null;

  constructor(
    readonly userId: string,
    file?: string,
  ) {
    const dir =
      process.env.LOCAL_DATA_DIR ||
      (process.env.VERCEL ? "/tmp/financeapp" : path.join(process.cwd(), ".data"));
    this.file = file ?? path.join(dir, "db.json");
  }

  private load(): DB {
    try {
      const stat = fs.statSync(this.file);
      if (this.cache && this.cache.mtime === stat.mtimeMs) return this.cache.db;
      const db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) } as DB;
      this.cache = { mtime: stat.mtimeMs, db };
      return db;
    } catch {
      const db = emptyDb();
      this.cache = { mtime: 0, db };
      return db;
    }
  }

  private save(db: DB) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, this.file);
    this.cache = { mtime: fs.statSync(this.file).mtimeMs, db };
  }

  async select<K extends TableName>(
    table: K,
    filter?: Filter<Tables[K]>,
    opts?: SelectOptions<Tables[K]>,
  ): Promise<Tables[K][]> {
    const rows = (this.load()[table] as Tables[K][]).filter(
      (r) => (r as { user_id: string }).user_id === this.userId && matches(r, filter),
    );
    if (opts?.order) {
      const { column, ascending = true } = opts.order;
      rows.sort((a, b) => {
        const av = a[column] as unknown as string | number;
        const bv = b[column] as unknown as string | number;
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    return structuredClone(opts?.limit ? rows.slice(0, opts.limit) : rows);
  }

  private complete<K extends TableName>(table: K, row: Record<string, unknown>): Tables[K] {
    const now = new Date().toISOString();
    const out: Record<string, unknown> = { ...row, user_id: this.userId };
    if (!NO_ID.includes(table) && !out.id) out.id = randomUUID();
    if (table !== "settings" && !out.created_at && table !== "accounts" && table !== "sync_log")
      out.created_at = now;
    if (HAS_UPDATED_AT.includes(table)) out.updated_at = now;
    return out as unknown as Tables[K];
  }

  async insert<K extends TableName>(table: K, rows: NewRow<Tables[K]>[]): Promise<Tables[K][]> {
    const db = this.load();
    const created = rows.map((r) => this.complete(table, r as Record<string, unknown>));
    (db[table] as Tables[K][]).push(...created);
    this.save(db);
    return structuredClone(created);
  }

  async upsert<K extends TableName>(
    table: K,
    rows: (NewRow<Tables[K]> & { id?: string })[],
    onConflict: string,
  ): Promise<Tables[K][]> {
    const db = this.load();
    const keys = onConflict.split(",").map((s) => s.trim());
    const list = db[table] as Tables[K][];
    const keyOf = (r: Record<string, unknown>) => keys.map((k) => String(r[k] ?? "")).join("|");
    const index = new Map<string, number>();
    list.forEach((r, i) => {
      if ((r as { user_id: string }).user_id === this.userId)
        index.set(keyOf(r as unknown as Record<string, unknown>), i);
    });
    const out: Tables[K][] = [];
    for (const raw of rows) {
      const r = { ...(raw as Record<string, unknown>), user_id: this.userId };
      const i = index.get(keyOf(r));
      if (i !== undefined) {
        const merged: Record<string, unknown> = { ...(list[i] as unknown as Record<string, unknown>), ...r };
        if (HAS_UPDATED_AT.includes(table)) merged.updated_at = new Date().toISOString();
        list[i] = merged as unknown as Tables[K];
        out.push(list[i]);
      } else {
        const created = this.complete(table, r);
        list.push(created);
        index.set(keyOf(created as unknown as Record<string, unknown>), list.length - 1);
        out.push(created);
      }
    }
    this.save(db);
    return structuredClone(out);
  }

  async update<K extends TableName>(
    table: K,
    filter: Filter<Tables[K]>,
    patch: Partial<Tables[K]>,
  ): Promise<number> {
    const db = this.load();
    let n = 0;
    const now = new Date().toISOString();
    db[table] = (db[table] as Tables[K][]).map((r) => {
      if ((r as { user_id: string }).user_id !== this.userId || !matches(r, filter)) return r;
      n++;
      const next = { ...r, ...patch } as Record<string, unknown>;
      if (HAS_UPDATED_AT.includes(table)) next.updated_at = now;
      return next as unknown as Tables[K];
    }) as DB[K];
    if (n) this.save(db);
    return n;
  }

  async remove<K extends TableName>(table: K, filter: Filter<Tables[K]>): Promise<number> {
    const db = this.load();
    const before = db[table].length;
    db[table] = (db[table] as Tables[K][]).filter(
      (r) => (r as { user_id: string }).user_id !== this.userId || !matches(r, filter),
    ) as DB[K];
    const n = before - db[table].length;
    if (n) this.save(db);
    return n;
  }
}
