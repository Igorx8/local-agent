export const emergencyCompactionInstruction = `Preserve exactly: task and current workflow stage; acceptance-criteria status; active files; Git commits and branch; constraining decisions; failed gates; unresolved findings; exact next action. Do not replace durable state or Git evidence with conversational memory.`;

export function opencodeCompactionPlugin(): string {
  return `export const EmergencyHandoffCompaction = async () => ({\n  \"experimental.session.compacting\": async (_input, output) => {\n    output.context.push(${JSON.stringify(emergencyCompactionInstruction)});\n  }\n});\n`;
}
