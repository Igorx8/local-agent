import path from "node:path";

export interface CommandSpec {
  command: string;
  args: string[];
  required: boolean;
  timeoutMs: number;
}

const deniedExecutables = new Set(["sudo", "su", "rm", "dd", "mkfs", "shutdown", "reboot", "sh", "bash", "dash", "zsh", "fish"]);
const deniedGitSubcommands = new Set(["push", "merge", "reset", "rebase", "clean"]);

export class PolicyViolation extends Error {}

export function validateCommand(spec: CommandSpec): CommandSpec {
  if (!spec.command || path.basename(spec.command) !== spec.command) throw new PolicyViolation("command must be a bare executable name");
  if (deniedExecutables.has(spec.command)) throw new PolicyViolation(`executable is denied: ${spec.command}`);
  if (spec.command === "git" && spec.args[0] && deniedGitSubcommands.has(spec.args[0])) throw new PolicyViolation(`git subcommand is denied: ${spec.args[0]}`);
  if (spec.args.some((arg) => arg.includes("\0"))) throw new PolicyViolation("NUL bytes are denied in arguments");
  if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0) throw new PolicyViolation("timeout must be a positive safe integer");
  return Object.freeze({ ...spec, args: Object.freeze([...spec.args]) as unknown as string[] });
}

export function assertPathWithin(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new PolicyViolation(`path escapes workspace root: ${candidate}`);
  return absoluteCandidate;
}
