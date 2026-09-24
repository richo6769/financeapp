import type { TableName, Tables } from "@/lib/types";

/** Minimal query filter supported by both the Supabase and local stores. */
export interface Filter<T> {
  eq?: Partial<Record<keyof T & string, string | number | boolean | null>>;
  in?: Partial<Record<keyof T & string, (string | number)[]>>;
  gte?: Partial<Record<keyof T & string, string | number>>;
  lte?: Partial<Record<keyof T & string, string | number>>;
}

export interface SelectOptions<T> {
  order?: { column: keyof T & string; ascending?: boolean };
  limit?: number;
}

/** Insert shape: user_id is filled by the store; id/timestamps are optional. */
export type NewRow<T> = Omit<T, "user_id" | "id" | "created_at" | "updated_at"> &
  Partial<Pick<T & { id: string; created_at: string; updated_at: string }, "id" | "created_at" | "updated_at">>;

/**
 * A user-scoped data store. Every read and write is filtered to `userId`
 * (the Supabase implementation additionally relies on RLS).
 */
export interface Store {
  readonly userId: string;
  readonly kind: "supabase" | "local";
  select<K extends TableName>(
    table: K,
    filter?: Filter<Tables[K]>,
    opts?: SelectOptions<Tables[K]>,
  ): Promise<Tables[K][]>;
  insert<K extends TableName>(table: K, rows: NewRow<Tables[K]>[]): Promise<Tables[K][]>;
  /** Insert or update rows matching on `onConflict` columns (comma separated). */
  upsert<K extends TableName>(
    table: K,
    rows: (NewRow<Tables[K]> & { id?: string })[],
    onConflict: string,
  ): Promise<Tables[K][]>;
  update<K extends TableName>(
    table: K,
    filter: Filter<Tables[K]>,
    patch: Partial<Tables[K]>,
  ): Promise<number>;
  remove<K extends TableName>(table: K, filter: Filter<Tables[K]>): Promise<number>;
}
