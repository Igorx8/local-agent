export interface MarkdownDeclaration {
  identifier: string;
  line: number;
}

export interface MarkdownQualityFinding {
  rule: "duplicate-structured-identifier";
  identifier: string;
  lines: number[];
}

export interface MarkdownQualityReport {
  declarations: MarkdownDeclaration[];
  findings: MarkdownQualityFinding[];
  passed: boolean;
}

const declaration = /^\s*(?:[-*+]\s+)?((?:TASK|ADR|EXP)-\d+)\s*:/i;

export function validateMarkdownQuality(content: string): MarkdownQualityReport {
  const declarations: MarkdownDeclaration[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const identifier = line.match(declaration)?.[1]?.toUpperCase();
    if (identifier) declarations.push({ identifier, line: index + 1 });
  }
  const grouped = new Map<string, number[]>();
  for (const item of declarations) grouped.set(item.identifier, [...(grouped.get(item.identifier) ?? []), item.line]);
  const findings = [...grouped.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([identifier, lines]) => ({ rule: "duplicate-structured-identifier" as const, identifier, lines }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
  return { declarations, findings, passed: findings.length === 0 };
}

export function assertMarkdownQuality(pathname: string, report: MarkdownQualityReport): void {
  if (report.passed) return;
  const detail = report.findings.map((finding) => `${finding.identifier} declared at lines ${finding.lines.join(", ")}`).join("; ");
  throw new Error(`Markdown quality gate failed for ${pathname}: ${detail}`);
}

export function assertMarkdownOutputPaths(files: string[]): void {
  if (!files.length) throw new Error("/doc must produce at least one Markdown change");
  const rejected = files.filter((file) => !file.toLowerCase().endsWith(".md"));
  if (rejected.length) throw new Error(`/doc may change Markdown files only: ${rejected.join(", ")}`);
}
