/**
 * Minimal database port used by repositories. D1 implements it; a Node + SQLite
 * adapter could implement it too (SPEC §2).
 */
export interface Db {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<void>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
}

export function d1Db(d1: D1Database): Db {
  const prep = (sql: string, params: unknown[] = []) => d1.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params?: unknown[]) {
      return (await prep(sql, params).all<T>()).results;
    },
    async first<T>(sql: string, params?: unknown[]) {
      return prep(sql, params).first<T>();
    },
    async run(sql, params) {
      await prep(sql, params).run();
    },
    async batch(statements) {
      await d1.batch(statements.map((s) => prep(s.sql, s.params)));
    },
  };
}
