import path from "node:path";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { applyStructuredIdentifierTransform, type MarkdownContract } from "./markdown-quality.js";

export interface WorkspaceTransformEvidence {
  file: string;
  applied: boolean;
  changedLines: number[];
  originalSha256?: string;
  resultSha256?: string;
  reason: string;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function applyWorkspaceMarkdownTransforms(repository: string, targets: string[], contract: MarkdownContract): Promise<WorkspaceTransformEvidence[]> {
  const root = await realpath(repository); const evidence: WorkspaceTransformEvidence[] = [];
  for (const file of targets) {
    const absolute = path.resolve(root, file);
    try {
      const parent = await realpath(path.dirname(absolute));
      if (!inside(root, parent)) { evidence.push({ file, applied: false, changedLines: [], reason: "target parent resolves outside repository" }); continue; }
      const target = path.join(parent, path.basename(absolute)); const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile()) { evidence.push({ file, applied: false, changedLines: [], reason: "target is not a regular non-symlink file" }); continue; }
      const transformed = applyStructuredIdentifierTransform(await readFile(target, "utf8"), contract);
      const item: WorkspaceTransformEvidence = { file, applied: transformed.applied, changedLines: transformed.changedLines, originalSha256: transformed.originalSha256, resultSha256: transformed.resultSha256, reason: transformed.reason };
      evidence.push(item);
      if (!transformed.applied) continue;
      const temporary = path.join(parent, "." + path.basename(target) + "." + crypto.randomUUID() + ".tmp");
      try {
        await writeFile(temporary, transformed.content, { mode: metadata.mode & 0o777 });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") evidence.push({ file, applied: false, changedLines: [], reason: "target does not exist yet" });
      else throw error;
    }
  }
  return evidence;
}
