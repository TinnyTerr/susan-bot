import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Loads the default export of every .ts file in a directory (non-recursive, skips *.d.ts).
export async function loadFiles<T>(dir: string): Promise<T[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: T[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    const mod = await import(join(dir, entry.name));
    if (mod.default) results.push(mod.default as T);
  }

  return results;
}
