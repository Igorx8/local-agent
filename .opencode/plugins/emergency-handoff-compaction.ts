import type { Plugin } from "@opencode-ai/plugin";

const instruction = "Preserve exactly: task and current workflow stage; acceptance-criteria status; active files; Git commits and branch; constraining decisions; failed gates; unresolved findings; exact next action. Do not replace durable state or Git evidence with conversational memory.";

export const EmergencyHandoffCompaction: Plugin = async () => ({
  "experimental.session.compacting": async (_input, output) => { output.context.push(instruction); }
});

export default EmergencyHandoffCompaction;
