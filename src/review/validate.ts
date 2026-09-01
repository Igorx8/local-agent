import type { Finding, Triage } from "../workflow/contracts.js";

export function confirmedFindings(findings: Finding[], triage: Triage): Finding[] {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return triage.findings.filter((item) => item.classification === "confirmed").map((item) => byId.get(item.findingId)).filter((finding): finding is Finding => Boolean(finding));
}
export function requiresHumanDecision(findings: Finding[], triage: Triage): boolean {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return triage.findings.some((item) => item.classification === "requires_human_decision" && ["critical", "high"].includes(byId.get(item.findingId)?.severity ?? ""));
}
export function validateRegressionEvidence(confirmed: Finding[], triage: Triage): void {
  const items = new Map(triage.findings.map((item) => [item.findingId, item]));
  for (const finding of confirmed) { const item = items.get(finding.id); if (item?.testable === false && !item.regressionTestExemption) throw new Error(`non-testable finding lacks regression-test exemption: ${finding.id}`); }
}
