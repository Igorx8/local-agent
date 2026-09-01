export const agentRoles = ["supervisor", "planner", "testArchitect", "implementer", "repositoryReviewer", "requirementsReviewer", "validator", "repair", "adversarialVerifier", "auditor"] as const;
export type AgentRole = typeof agentRoles[number];

export interface AgentPolicy { role: AgentRole; model: string; canEdit: boolean; canDelegate: boolean; structuredOutput: boolean; }

export function buildAgentPolicies(models: Record<AgentRole, string>): AgentPolicy[] {
  const editing = new Set<AgentRole>(["implementer", "repair"]);
  return agentRoles.map((role) => ({ role, model: models[role], canEdit: editing.has(role), canDelegate: role === "supervisor", structuredOutput: true }));
}
