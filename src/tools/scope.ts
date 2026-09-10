export interface ChangeSummary { files: string[]; addedLines: number; dependencyFiles: string[]; publicApiChanged: boolean; migrations: string[]; productionConfig: string[]; }
export interface ScopePolicy { allowedPaths: string[]; deniedPaths: string[]; maxChangedFilesBeforeReview: number; maxAddedLinesBeforeReview: number; requireDependencyChangeJustification: boolean; requirePublicApiChangeJustification: boolean; requireMigrationJustification: boolean; }
export interface ScopeFinding { code: string; evidence: string; requiresJustification: boolean; }

function prefixMatch(file: string, prefixes: string[]): boolean { return prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix.replace(/\/$/, "")}/`)); }

export function evaluateScope(change: ChangeSummary, policy: ScopePolicy): ScopeFinding[] {
  const findings: ScopeFinding[] = [];
  for (const file of change.files) {
    if (prefixMatch(file, policy.deniedPaths)) findings.push({ code: "DENIED_PATH", evidence: file, requiresJustification: false });
    if (policy.allowedPaths.length && !prefixMatch(file, policy.allowedPaths)) findings.push({ code: "OUTSIDE_ALLOWED_PATH", evidence: file, requiresJustification: false });
  }
  if (change.files.length > policy.maxChangedFilesBeforeReview) findings.push({ code: "CHANGED_FILE_BUDGET", evidence: `${change.files.length} > ${policy.maxChangedFilesBeforeReview}`, requiresJustification: true });
  if (change.addedLines > policy.maxAddedLinesBeforeReview) findings.push({ code: "ADDED_LINE_BUDGET", evidence: `${change.addedLines} > ${policy.maxAddedLinesBeforeReview}`, requiresJustification: true });
  if (change.dependencyFiles.length && policy.requireDependencyChangeJustification) findings.push({ code: "DEPENDENCY_CHANGE", evidence: change.dependencyFiles.join(", "), requiresJustification: true });
  if (change.publicApiChanged && policy.requirePublicApiChangeJustification) findings.push({ code: "PUBLIC_API_CHANGE", evidence: "public API changed", requiresJustification: true });
  if (change.migrations.length && policy.requireMigrationJustification) findings.push({ code: "MIGRATION_CHANGE", evidence: change.migrations.join(", "), requiresJustification: true });
  return findings;
}

export function globExpression(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") { if (pattern[index + 2] === "/") { source += "(?:.*/)?"; index += 2; } else { source += ".*"; index++; } }
    else if (character === "*") source += "[^/]*";
    else source += character?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function pathMatchesAnyPattern(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globExpression(pattern).test(file));
}

export function assertChangedPathsAllowed(files: string[], allowedPaths: string[], deniedPatterns: string[]): void {
  for (const file of files) {
    if (pathMatchesAnyPattern(file, deniedPatterns)) throw new Error(`changed path is denied: ${file}`);
    if (allowedPaths.length && !prefixMatch(file, allowedPaths)) throw new Error(`changed path is outside allowed scope: ${file}`);
  }
}
