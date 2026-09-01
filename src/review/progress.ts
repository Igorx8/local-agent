import type { GateResult } from "../tools/gates.js";
import type { Finding } from "../workflow/contracts.js";

const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
export interface IterationEvidence { gates: GateResult[]; confirmed: Finding[]; provenCriteria: number; changedFiles: number; }
export interface ProgressDecision { decision: "continue" | "stop_success" | "stop_stagnated" | "escalate"; improvements: string[]; regressions: string[]; remainingConfirmedFindings: string[]; evidence: string[]; }
function failures(value: IterationEvidence): number { return value.gates.filter((gate) => gate.required && gate.status !== "passed").length; }
function maximumSeverity(value: IterationEvidence): number { return Math.max(0, ...value.confirmed.map((finding) => severityRank[finding.severity])); }

export function evaluateProgress(previous: IterationEvidence | undefined, current: IterationEvidence): ProgressDecision {
  const blocking = current.confirmed.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (!failures(current) && !blocking.length) return { decision: "stop_success", improvements: [], regressions: [], remainingConfirmedFindings: current.confirmed.map((finding) => finding.id), evidence: ["required gates pass and no high/critical confirmed findings"] };
  if (!previous) return { decision: "continue", improvements: ["initial repair evidence established"], regressions: [], remainingConfirmedFindings: current.confirmed.map((finding) => finding.id), evidence: [`gateFailures=${failures(current)}`, `confirmed=${current.confirmed.length}`] };
  const improvements: string[] = []; const regressions: string[] = [];
  if (failures(current) < failures(previous)) improvements.push("fewer required gate failures"); else if (failures(current) > failures(previous)) regressions.push("more required gate failures");
  if (current.confirmed.length < previous.confirmed.length) improvements.push("fewer confirmed findings"); else if (current.confirmed.length > previous.confirmed.length) regressions.push("more confirmed findings");
  if (maximumSeverity(current) < maximumSeverity(previous)) improvements.push("reduced maximum severity"); else if (maximumSeverity(current) > maximumSeverity(previous)) regressions.push("increased maximum severity");
  if (current.provenCriteria > previous.provenCriteria) improvements.push("additional acceptance criteria proven");
  if (current.changedFiles < previous.changedFiles && failures(current) <= failures(previous)) improvements.push("reduced diff churn");
  if (current.confirmed.some((finding) => finding.severity === "critical") && !previous.confirmed.some((finding) => finding.severity === "critical")) return { decision: "escalate", improvements, regressions: [...regressions, "new critical finding"], remainingConfirmedFindings: current.confirmed.map((finding) => finding.id), evidence: [] };
  return { decision: improvements.length ? "continue" : "stop_stagnated", improvements, regressions, remainingConfirmedFindings: current.confirmed.map((finding) => finding.id), evidence: [`gateFailures=${failures(current)}`, `confirmed=${current.confirmed.length}`, `maxSeverity=${maximumSeverity(current)}`] };
}
