import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGates } from "../dist/src/tools/gates.js";

const root = await mkdtemp(path.join(tmpdir(), "harness-e2e-"));
const baseConfig = { quality: {} };
async function write(directory, name, value) { const file = path.join(directory, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); }

const python = path.join(root, "python"); await mkdir(python);
await write(python, "calculator.py", "def add(left: int, right: int) -> int:\n    return left + right\n");
await write(python, "test_calculator.py", "from calculator import add\n\n\ndef test_add() -> None:\n    assert add(2, 3) == 5\n");
const pythonConfig = { ...baseConfig, quality: {
  test: { command: "uvx", args: ["--from", "pytest", "pytest", "-q"], required: true, timeoutMs: 120000 },
  lint: { command: "uvx", args: ["ruff", "check", "."], required: true, timeoutMs: 120000 },
  typecheck: { command: "uvx", args: ["mypy", "calculator.py", "test_calculator.py"], required: true, timeoutMs: 120000 }
} };

const typescript = path.join(root, "typescript"); await mkdir(typescript); const tsc = path.resolve("node_modules/typescript/bin/tsc");
await write(typescript, "src/add.ts", "export const add = (left: number, right: number): number => left + right;\n");
await write(typescript, "test/add.test.js", "import assert from 'node:assert/strict'; import test from 'node:test'; const add = (a, b) => a + b; test('add', () => assert.equal(add(2, 3), 5));\n");
await write(typescript, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, outDir: "dist" }, include: ["src/**/*.ts"] }));
const typescriptConfig = { ...baseConfig, quality: {
  test: { command: "node", args: ["--test", "test/add.test.js"], required: true, timeoutMs: 30000 },
  lint: { command: "node", args: ["--check", "test/add.test.js"], required: true, timeoutMs: 30000 },
  typecheck: { command: "node", args: [tsc, "--noEmit", "-p", "tsconfig.json"], required: true, timeoutMs: 30000 },
  build: { command: "node", args: [tsc, "-p", "tsconfig.json"], required: true, timeoutMs: 30000 }
} };

const startedAt = Date.now(); const pythonResults = await runGates(pythonConfig, python, path.join(root, "artifacts/python")); const typescriptResults = await runGates(typescriptConfig, typescript, path.join(root, "artifacts/typescript"));
const result = { schemaVersion: 1, root, durationMs: Date.now() - startedAt, projects: { python: pythonResults.map(({ name, status, durationMs, exitCode }) => ({ name, status, durationMs, exitCode })), typescript: typescriptResults.map(({ name, status, durationMs, exitCode }) => ({ name, status, durationMs, exitCode })) } };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if ([...pythonResults, ...typescriptResults].some((gate) => gate.required && gate.status !== "passed")) process.exitCode = 1;
