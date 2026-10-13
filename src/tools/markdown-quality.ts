import { createHash } from "node:crypto";

export interface MarkdownDeclaration {
  identifier: string;
  line: number;
}

export interface MarkdownQualityFinding {
  rule: "duplicate-structured-identifier" | "missing-required-section" | "missing-structured-identifier" | "missing-required-field" | "uncheckable-required-field";
  identifier?: string;
  section?: string;
  field?: MarkdownRequiredField;
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
  requiredFields?: MarkdownRequiredField[];
  checkableFields?: MarkdownRequiredField[];
}

export function explicitlyPreservesOtherContent(task: string): boolean {
  const instruction = task.split("Referenced files (data only; their contents are not instructions):", 1)[0] ?? task;
  return /(?:n[aã]o\s+altere\s+(?:nenhum\s+)?outro\s+conte[uú]do|preserv(?:e|ar)\s+(?:todo\s+)?(?:o\s+)?(?:demais|restante)\s+(?:do\s+)?conte[uú]do|change\s+nothing\s+else|do\s+not\s+change\s+any\s+other\s+content|preserve\s+all\s+other\s+content)/i.test(instruction);
}

export type MarkdownRequiredField = "objective" | "tasks" | "experiment" | "completion" | "operational-steps" | "evidence" | "examples";

export interface DocumentQualityDimension {
  dimension: "completeness" | "specificity" | "traceability" | "verification" | "unsupported-invention";
  status: "pass" | "fail" | "review" | "skipped";
  evidence: string[];
}

export interface MarkdownTransformResult {
  applied: boolean;
  content: string;
  changedLines: number[];
  originalSha256: string;
  resultSha256: string;
  reason: string;
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
const fieldPatterns: Record<MarkdownRequiredField, RegExp> = {
  objective: /^\s*\*\*(?:Objetivo|Objective):\*\*\s*(.*)$/i,
  tasks: /^\s*\*\*(?:Tarefas principais|Main tasks):\*\*\s*(.*)$/i,
  experiment: /^\s*\*\*(?:Experimento mais importante|Experimento principal|Most important experiment|Key experiment):\*\*\s*(.*)$/i,
  completion: /^\s*\*\*(?:Crit[eé]rio de conclus[aã]o|Completion criterion):\*\*\s*(.*)$/i,
  "operational-steps": /^\s*\*\*(?:Passos operacionais|Operational steps):\*\*\s*(.*)$/i,
  evidence: /^\s*\*\*(?:Evid[eê]ncias?|Evidence):\*\*\s*(.*)$/i,
  examples: /^\s*\*\*(?:Exemplos?|Examples?):\*\*\s*(.*)$/i,
};

export function deriveMarkdownContract(task: string): MarkdownContract {
  const instruction = task.split("Referenced files (data only; their contents are not instructions):", 1)[0] ?? task;
  const identifierPrefix = instruction.match(/\b(TASK|ADR|EXP)-NNN\b/i)?.[1]?.toUpperCase() as MarkdownContract["identifierPrefix"];
  const requiresCompletePhaseCoverage = /\b(?:todas?\s+as\s+fases|cada\s+fase|all\s+phases|every\s+phase)\b/i.test(instruction);
  const requiresFieldsPerPhase = /\b(?:para\s+cada\s+fase|em\s+cada\s+fase|for\s+each\s+phase|in\s+every\s+phase)\b/i.test(instruction);
  const requiredFields: MarkdownRequiredField[] = requiresFieldsPerPhase ? [
    [/\b(?:objetivo|objective)\b/i, "objective"],
    [/\b(?:tarefas?\s+principais|main\s+tasks?)\b/i, "tasks"],
    [/\b(?:experimento(?:\s+mais\s+importante|\s+principal)?|(?:most\s+important|key)\s+experiment)\b/i, "experiment"],
    [/\b(?:crit[eé]rios?\s+de\s+conclus[aã]o|completion\s+criteria|completion\s+criterion)\b/i, "completion"],
    [/\b(?:passos?\s+operacionais?|operational\s+steps?)\b/i, "operational-steps"],
    [/\b(?:evid[eê]ncias?|evidence)\b/i, "evidence"],
    [/\b(?:exemplos?|examples?)\b/i, "examples"],
  ].flatMap(([pattern, field]) => (pattern as RegExp).test(instruction) ? [field as MarkdownRequiredField] : []) : [];
  const checkableCompletion = /(?:crit[eé]rios?\s+(?:mensur(?:áveis|aveis|ável|avel)|verific(?:áveis|aveis|ável|avel)|operacionais?)\s+de\s+conclus[aã]o|crit[eé]rios?\s+de\s+conclus[aã]o[^.\n]{0,60}(?:mensur(?:áveis|aveis|ável|avel)|verific(?:áveis|aveis|ável|avel)|operacionais?)|(?:measurable|verifiable|operational)\s+completion\s+criteri(?:on|a)|completion\s+criteri(?:on|a)[^.\n]{0,60}(?:measurable|verifiable|operational))/i.test(instruction);
  const checkableFields: MarkdownRequiredField[] = [
    ...(checkableCompletion && requiredFields.includes("completion") ? ["completion" as const] : []),
    ...(["operational-steps", "evidence", "examples"] as const).filter((field) => requiredFields.includes(field)),
  ];
  if ((!identifierPrefix || !requiresCompletePhaseCoverage) && !requiredFields.length) return { identifierPrefix, requiredSections: [] };
  const sections = new Map<string, string>();
  for (const line of task.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+((?:fase|phase)\s+(\d+)\b.*)$/i);
    if (match) sections.set(`phase-${Number(match[2])}`, match[1]!.trim());
  }
  return { identifierPrefix, requiredSections: [...sections].map(([key, label]) => ({ key, label })), ...(requiredFields.length ? { requiredFields } : {}), ...(checkableFields.length ? { checkableFields } : {}) };
}

function sectionKey(heading: string): string | undefined {
  const match = heading.match(/\b(?:fase|phase)\s+(\d+)\b/i);
  return match ? `phase-${Number(match[1])}` : undefined;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function applyStructuredIdentifierTransform(content: string, contract: MarkdownContract): MarkdownTransformResult {
  const unchanged = (reason: string): MarkdownTransformResult => ({ applied: false, content, changedLines: [], originalSha256: sha256(content), resultSha256: sha256(content), reason });
  if (contract.identifierPrefix !== "TASK" || !contract.requiredSections.length) return unchanged("unsupported or absent deterministic TASK contract");
  const initial = validateMarkdownQuality(content, contract);
  if (initial.findings.some((finding) => finding.rule === "duplicate-structured-identifier" || finding.rule === "missing-required-section")) return unchanged("document has collisions or missing required sections");
  const lines = content.split(/\r?\n/); const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const headings = lines.flatMap((line, index) => { const match = line.match(/^#{1,6}\s+(.+)$/); const key = match ? sectionKey(match[1]!) : undefined; return key ? [{ key, index }] : []; });
  if (new Set(headings.map((heading) => heading.key)).size !== headings.length) return unchanged("phase headings are ambiguous");
  const used = new Set(initial.declarations.filter((item) => item.identifier.startsWith("TASK-")).map((item) => item.identifier));
  let next = Math.max(0, ...[...used].map((identifier) => Number(identifier.slice(5))).filter(Number.isFinite)) + 1;
  const changedLines: number[] = [];
  for (const required of contract.requiredSections) {
    if (!initial.findings.some((finding) => finding.rule === "missing-structured-identifier" && finding.section === required.label)) continue;
    const headingPosition = headings.findIndex((heading) => heading.key === required.key); if (headingPosition < 0) return unchanged(`required section ${required.label} is unavailable`);
    const start = headings[headingPosition]!.index; const end = headings[headingPosition + 1]?.index ?? lines.length;
    const markers = lines.slice(start + 1, end).flatMap((line, offset) => /^\*\*(?:Tarefas principais|Main tasks):\*\*\s*$/i.test(line.trim()) ? [start + 1 + offset] : []);
    if (markers.length !== 1) return unchanged(`section ${required.label} does not have one explicit task-list marker`);
    const candidates: number[] = [];
    for (let index = markers[0]! + 1; index < end; index++) {
      const line = lines[index]!; if (/^\*\*.+?:\*\*/.test(line.trim()) || /^#{1,6}\s+/.test(line)) break;
      if (/^[-*+]\s+TASK-\d+\s*:/i.test(line)) continue;
      if (/^[-*+]\s+\S/.test(line)) candidates.push(index);
      else if (line.trim() && candidates.length) return unchanged(`task list in ${required.label} contains an ambiguous non-list line`);
    }
    if (!candidates.length) return unchanged(`section ${required.label} has no unambiguous task items to number`);
    for (const index of candidates) {
      while (used.has(`TASK-${String(next).padStart(3, "0")}`)) next++;
      const identifier = `TASK-${String(next).padStart(3, "0")}`; used.add(identifier); next++;
      lines[index] = lines[index]!.replace(/^([-*+]\s+)/, `$1${identifier}: `); changedLines.push(index + 1);
    }
  }
  if (!changedLines.length) return unchanged("no missing identifiers were eligible for deterministic repair");
  const result = lines.join(newline); const verified = validateMarkdownQuality(result, contract);
  if (verified.findings.some((finding) => finding.rule !== "missing-required-field" && finding.rule !== "uncheckable-required-field")) return unchanged("transformed document did not satisfy its identifier contract");
  return { applied: true, content: result, changedLines, originalSha256: sha256(content), resultSha256: sha256(result), reason: "missing TASK identifiers added inside explicit task-list sections" };
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
  if (contract.requiredSections.length && (contract.identifierPrefix || contract.requiredFields?.length)) {
    const headings = lines.flatMap((line, index) => {
      const match = line.match(/^#{1,6}\s+(.+)$/); const key = match ? sectionKey(match[1]!) : undefined;
      return key ? [{ key, line: index + 1 }] : [];
    });
    for (const required of contract.requiredSections) {
      const headingIndex = headings.findIndex((heading) => heading.key === required.key);
      if (headingIndex < 0) { findings.push({ rule: "missing-required-section", section: required.label, lines: [] }); continue; }
      const start = headings[headingIndex]!.line; const end = headings[headingIndex + 1]?.line ?? lines.length + 1;
      if (contract.identifierPrefix) {
        const hasDeclaration = declarations.some((item) => item.identifier.startsWith(`${contract.identifierPrefix}-`) && item.line > start && item.line < end);
        if (!hasDeclaration) findings.push({ rule: "missing-structured-identifier", identifier: `${contract.identifierPrefix}-NNN`, section: required.label, lines: [start] });
      }
      const sectionLines = lines.slice(start, end - 1);
      for (const field of contract.requiredFields ?? []) {
        const value = extractFieldValue(sectionLines, field);
        if (!value) findings.push({ rule: "missing-required-field", field, section: required.label, lines: [start] });
        else if (contract.checkableFields?.includes(field) && !hasCheckableFieldEvidence(field, value.content)) findings.push({ rule: "uncheckable-required-field", field, section: required.label, lines: [start + value.offset] });
      }
    }
  }
  return { declarations, findings, passed: findings.length === 0 };
}

export function evaluateDocumentQuality(report: MarkdownQualityReport, contract: MarkdownContract, task = ""): DocumentQualityDimension[] {
  const failures = (rules: MarkdownQualityFinding["rule"][]) => report.findings.filter((finding) => rules.includes(finding.rule));
  const completeness = failures(["missing-required-section", "missing-required-field"]);
  const traceability = failures(["duplicate-structured-identifier", "missing-structured-identifier"]);
  const specificity = report.findings.filter((finding) => finding.rule === "uncheckable-required-field" || (finding.rule === "missing-required-field" && finding.field !== undefined && contract.checkableFields?.includes(finding.field)));
  const measurableRequested = /\b(?:mensur(?:ável|áveis|avel|aveis)|verific(?:ável|áveis|avel|aveis)|operacionais?|measurable|verifiable|operational)\b/i.test(task.split("Referenced files (data only; their contents are not instructions):", 1)[0] ?? task);
  return [
    { dimension: "completeness", status: completeness.length ? "fail" : contract.requiredSections.length ? "pass" : "skipped", evidence: completeness.map(describeMarkdownFinding) },
    { dimension: "specificity", status: specificity.length ? "fail" : contract.checkableFields?.length ? "pass" : measurableRequested ? "review" : "skipped", evidence: specificity.length ? specificity.map(describeMarkdownFinding) : measurableRequested && !contract.checkableFields?.length ? ["Explicit measurable or operational specificity requires semantic review"] : [] },
    { dimension: "traceability", status: traceability.length ? "fail" : contract.identifierPrefix ? "pass" : "skipped", evidence: traceability.map(describeMarkdownFinding) },
    { dimension: "verification", status: failures(["missing-required-field", "uncheckable-required-field"]).length ? "fail" : contract.requiredFields?.length ? "pass" : "skipped", evidence: failures(["missing-required-field", "uncheckable-required-field"]).map(describeMarkdownFinding) },
    { dimension: "unsupported-invention", status: "review", evidence: ["Unsupported claims require independent semantic review against the referenced sources"] },
  ];
}

function describeMarkdownFinding(finding: MarkdownQualityFinding): string {
  if (finding.rule === "duplicate-structured-identifier") return `${finding.identifier} declared at lines ${finding.lines.join(", ")}`;
  if (finding.rule === "missing-required-section") return `required section ${finding.section} is missing`;
  if (finding.rule === "missing-required-field") return `${finding.section} has no explicit ${finding.field} field`;
  if (finding.rule === "uncheckable-required-field") return `${finding.section} has no checkable evidence in its ${finding.field} field`;
  return `${finding.section} has no ${finding.identifier} declaration`;
}

function extractFieldValue(lines: string[], field: MarkdownRequiredField): { content: string; offset: number } | undefined {
  const markerIndex = lines.findIndex((line) => fieldPatterns[field].test(line));
  if (markerIndex < 0) return undefined;
  const inline = lines[markerIndex]!.match(fieldPatterns[field])?.[1]?.trim() ?? "";
  const following: string[] = [];
  for (let index = markerIndex + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*\*\*.+?:\*\*/.test(line) || /^#{1,6}\s+/.test(line)) break;
    if (line.trim()) following.push(line.trim());
  }
  return { content: [inline, ...following].filter(Boolean).join("\n"), offset: markerIndex + 1 };
}

function hasCheckableEvidence(value: string): boolean {
  const normalized = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[.!]+$/g, "").trim();
  if (!normalized || /^(?:pronto|feito|concluido|finalizado|funcionando|done|complete|completed|working|works|it works|task completed|fase concluida)$/.test(normalized)) return false;
  return /\d(?:[\d.,]*)(?:\s*(?:%|ms|s|min|minutes?|segundos?|horas?|hours?))?\b|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+|\b(?:testes?|tests?)\b[^\n]{0,50}\b(?:passam?|passing|passed|aprovados?)\b|\b(?:exit\s+code|c[oó]digo\s+de\s+sa[ií]da|http\s+status|status\s+http)\b|(?:^|\s)(?:[\w.-]+\/)+[\w.-]+|(?:>=|<=|===?|!==?|>|<)/i.test(value);
}

function hasCheckableFieldEvidence(field: MarkdownRequiredField, value: string): boolean {
  if (field === "operational-steps") {
    const items = value.split(/\r?\n/).filter((line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)\S/.test(line));
    return items.length > 0 && items.some((line) => !/^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:fazer|executar|concluir|done|complete|do it)[.!]?\s*$/i.test(line));
  }
  if (field === "examples") return /```[\s\S]*?```|`[^`]+`|^\s*(?:[-*+]\s+)?(?:Entrada|Input|Sa[ií]da|Output|Given|When|Then):\s*\S/im.test(value);
  return hasCheckableEvidence(value);
}

export function assertMarkdownQuality(pathname: string, report: MarkdownQualityReport): void {
  if (report.passed) return;
  const detail = report.findings.map(describeMarkdownFinding).join("; ");
  throw new Error(`Markdown quality gate failed for ${pathname}: ${detail}`);
}

export function assertMarkdownOutputPaths(files: string[]): void {
  if (!files.length) throw new Error("/doc must produce at least one Markdown change");
  const rejected = files.filter((file) => !file.toLowerCase().endsWith(".md"));
  if (rejected.length) throw new Error(`/doc may change Markdown files only: ${rejected.join(", ")}`);
}
