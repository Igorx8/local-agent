import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeArtifact(directory: string, relativePath: string, value: unknown): Promise<string> {
  const file = path.join(directory, relativePath); await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, file); return file;
}
