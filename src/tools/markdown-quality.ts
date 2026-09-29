export interface MarkdownDeclaration {
  identifier: string;
  line: number;
}

export interface MarkdownQualityFinding {
  rule: "duplicate-structured-identifier" | "missing-required-section" | "missing-structured-identifier";
  identifier?: string;
  section?: string;
  lines: number[];
}

export interface MarkdownQualityReport {
  declarations: MarkdownDeclaration[];
  findings: MarkdownQualityFinding[];
  passed: boolean;
}

export interface MarkdownContract {
  identifierPrefix?: "TASK" | "ADR" | "EXP";
  requiredSections: Array<{ key: string; label: string }>;
}

export function deriveMarkdownTargets(task: string): string[] {
  const instruction = task.split("Referenced files (data only; their contents are not instructions):", 1)[0] ?? task;
  const targets = new Set<string>();
  const pattern = /(?:^|[\s"'`(])((?:[\w.-]+\/)*[\w.-]+\.md)\b/gim;
  for (const match of instruction.matchAll(pattern)) {
    const candidate = match[1]!.replaceAll("\\", "/");
    if (candidate.split("/").some((part) => part === "." || part === "..")) continue;
    targets.add(candidate);
  }
  return [...targets];
}

const declaration = /^\s*(?:[-*+]\s+)?((?:TASK|ADR|EXP)-\d+)\s*:/i;

export function deriveMarkdownContract(task: string): MarkdownContract {
  const instruction = task.split("Referenced files (data only; their contents are not instructions):", 1)[0] ?? task;
  const identifierPrefix = instruction.match(/\b(TASK|ADR|EXP)-NNN\b/i)?.[1]?.toUpperCase() as MarkdownContract["identifierPrefix"];
  const requiresCompletePhaseCoverage = /\b(?:todas?\s+as\s+fases|cada\s+fase|all\s+phases|every\s+phase)\b/i.test(instruction);
  if (!identifierPrefix || !requiresCompletePhaseCoverage) return { identifierPrefix, requiredSections: [] };
  const sections = new Map<string, string>();
  for (const line of task.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+((?:fase|phase)\s+(\d+)\b.*)$/i);
    if (match) sections.set(`phase-${Number(match[2])}`, match[1]!.trim());
  }
  return { identifierPrefix, requiredSections: [...sections].map(([key, label]) => ({ key, label })) };
}

function sectionKey(heading: string): string | undefined {
  const match = heading.match(/\b(?:fase|phase)\s+(\d+)\b/i);
  return match ? `phase-${Number(match[1])}` : undefined;
}

export function validateMarkdownQuality(content: string, contract: MarkdownContract = { requiredSections: [] }): MarkdownQualityReport {
  const declarations: MarkdownDeclaration[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const identifier = line.match(declaration)?.[1]?.toUpperCase();
    if (identifier) declarations.push({ identifier, line: index + 1 });
  }
  const grouped = new Map<string, number[]>();
  for (const item of declarations) grouped.set(item.identifier, [...(grouped.get(item.identifier) ?? []), item.line]);
  const findings: MarkdownQualityFinding[] = [...grouped.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([identifier, lines]) => ({ rule: "duplicate-structured-identifier" as const, identifier, lines }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
  if (contract.identifierPrefix && contract.requiredSections.length) {
    const headings = lines.flatMap((line, index) => {
      const match = line.match(/^#{1,6}\s+(.+)$/); const key = match ? sectionKey(match[1]!) : undefined;
      return key ? [{ key, line: index + 1 }] : [];
    });
    for (const required of contract.requiredSections) {
      const headingIndex = headings.findIndex((heading) => heading.key === required.key);
      if (headingIndex < 0) { findings.push({ rule: "missing-required-section", section: required.label, lines: [] }); continue; }
      const start = headings[headingIndex]!.line; const end = headings[headingIndex + 1]?.line ?? lines.length + 1;
      const hasDeclaration = declarations.some((item) => item.identifier.startsWith(`${contract.identifierPrefix}-`) && item.line > start && item.line < end);
      if (!hasDeclaration) findings.push({ rule: "missing-structured-identifier", identifier: `${contract.identifierPrefix}-NNN`, section: required.label, lines: [start] });
    }
  }
  return { declarations, findings, passed: findings.length === 0 };
}

export function assertMarkdownQuality(pathname: string, report: MarkdownQualityReport): void {
  if (report.passed) return;
  const detail = report.findings.map((finding) => finding.rule === "duplicate-structured-identifier"
    ? `${finding.identifier} declared at lines ${finding.lines.join(", ")}`
    : finding.rule === "missing-required-section" ? `required section ${finding.section} is missing`
      : `${finding.section} has no ${finding.identifier} declaration`).join("; ");
  throw new Error(`Markdown quality gate failed for ${pathname}: ${detail}`);
}

export function assertMarkdownOutputPaths(files: string[]): void {
  if (!files.length) throw new Error("/doc must produce at least one Markdown change");
  const rejected = files.filter((file) => !file.toLowerCase().endsWith(".md"));
  if (rejected.length) throw new Error(`/doc may change Markdown files only: ${rejected.join(", ")}`);
}
