import type { Finding, Review } from "../workflow/contracts.js";

export interface MergedFinding extends Finding { sources: Array<"repository" | "requirements">; duplicateIds: string[]; }
function normalized(value?: string): string { return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim(); }
function key(finding: Finding): string { return [finding.acceptanceCriterion, finding.file, finding.lineStart, normalized(finding.problem), normalized(finding.reproduction)].join("|"); }

export function mergeReviews(repository: Review, requirements: Review): MergedFinding[] {
  const merged = new Map<string, MergedFinding>();
  for (const [source, review] of [["repository", repository], ["requirements", requirements]] as const) for (const finding of review.findings) {
    const identity = key(finding); const existing = merged.get(identity);
    if (existing) { existing.sources.push(source); existing.duplicateIds.push(finding.id); }
    else merged.set(identity, { ...finding, sources: [source], duplicateIds: [] });
  }
  return [...merged.values()];
}
