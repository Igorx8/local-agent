export const slashCommands = ["ask", "fix", "run", "apply", "help", "status", "memory", "files", "worktree", "model", "doctor", "report", "new", "resume", "pause", "handoff", "clear", "exit"] as const;
export type SlashCommandName = (typeof slashCommands)[number];
export interface SlashCommand { name: SlashCommandName; args: string[]; web?: boolean; }

export const shellHelp = `Slash commands:
  /ask [--web] <text>   one fast read-only answer
  /fix <task>           focused fix with gates and review
  /run <task>           complete audited engineering workflow
  /apply [run-id]       apply a preserved checkpoint to this working tree
  /help                 show this help
  /status               conversation and latest run status
  /memory               bounded memory summary (no prompt contents)
  /files                referenced-file provenance from recent turns
  /worktree             latest isolated worktree and commit
  /model                managed model process and advertised aliases
  /doctor               local runtime diagnostics
  /report [run-id]      generate the run report
  /new                  select a new conversation for the next prompt
  /resume [run-id]      resume a paused/interrupted run
  /pause [run-id]       request a cooperative pause
  /handoff [run-id]     request a safe context handoff
  /clear                clear terminal presentation only
  /exit                 close the shell safely

Plain text starts a workflow turn. Use @path, @"path with spaces", or @@ for a literal @.`;

function argv(value: string): string[] {
  const result: string[] = []; let current = ""; let quote: string | undefined;
  for (let index = 0; index < value.length; index++) { const character = value[index]!; if (quote) { if (character === quote) quote = undefined; else current += character; } else if (character === '"' || character === "'") quote = character; else if (/\s/.test(character)) { if (current) { result.push(current); current = ""; } } else current += character; }
  if (quote) throw new Error("unterminated quote in slash command"); if (current) result.push(current); return result;
}

export function parseSlashCommand(value: string): SlashCommand | undefined {
  const trimmed = value.trim(); if (!trimmed.startsWith("/")) return undefined; const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/); const name = match?.[1];
  if (!name || !slashCommands.includes(name as SlashCommandName)) throw new Error(`unknown slash command: /${name ?? ""}; use /help`);
  if (name === "ask" || name === "fix" || name === "run") { let prompt = (match?.[2] ?? "").trim(); let web = false; if (name === "ask" && /^(?:--web)(?:\s|$)/.test(prompt)) { web = true; prompt = prompt.replace(/^--web(?:\s+|$)/, ""); } if (!prompt) throw new Error(`/${name} requires a prompt`); return { name, args: [prompt], ...(web ? { web } : {}) }; }
  const parts = argv(match?.[2] ?? "");
  const noArguments: SlashCommandName[] = ["help", "status", "memory", "files", "worktree", "model", "doctor", "new", "clear", "exit"];
  if (noArguments.includes(name as SlashCommandName) && parts.length) throw new Error(`/${name} does not accept arguments`); if (parts.length > 1) throw new Error(`/${name} accepts at most one run ID`);
  return { name: name as SlashCommandName, args: parts };
}

export function routePlainInput(value: string): "ask" | "run" { return /\?\s*$/.test(value) || /^(?:quem|qual|quais|quando|onde|por\s+que|porque|como|o\s+que|você|voce|vc|can|could|what|why|how|when|where|who)\b/i.test(value.trim()) ? "ask" : "run"; }

export function completeSlash(line: string): [string[], string] {
  const token = line.trimStart(); if (!token.startsWith("/") || token.includes(" ")) return [[], line]; const matches = slashCommands.map((name) => `/${name}`).filter((name) => name.startsWith(token)); return [matches.length ? matches : slashCommands.map((name) => `/${name}`), token];
}
