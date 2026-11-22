/**
 * Tables in progress, saved so a restart or deploy can bring them back: one JSON file per
 * table, replaced whole on every change (written to a temporary file, then renamed, so a
 * crash mid-write never leaves half a table).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SavedTable {
  code: string;
  data: string;
  updatedAt: number;
}

export interface TableStore {
  save(code: string, data: string): void;
  delete(code: string): void;
  all(): SavedTable[];
}

const CODE = /^[A-Z]{4}$/;

export function fileTableStore(dir: string): TableStore {
  mkdirSync(dir, { recursive: true });
  const file = (code: string) => join(dir, `${code}.json`);
  return {
    save(code, data) {
      if (!CODE.test(code)) return;
      const tmp = `${file(code)}.tmp`;
      writeFileSync(tmp, data);
      renameSync(tmp, file(code));
    },
    delete(code) {
      if (CODE.test(code)) rmSync(file(code), { force: true });
    },
    all() {
      const out: SavedTable[] = [];
      for (const name of readdirSync(dir)) {
        const code = name.replace(/\.json$/, '');
        if (!name.endsWith('.json') || !CODE.test(code)) continue;
        try {
          out.push({ code, data: readFileSync(file(code), 'utf8'), updatedAt: statSync(file(code)).mtimeMs });
        } catch {}
      }
      return out;
    },
  };
}
