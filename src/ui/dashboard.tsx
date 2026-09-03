import React from "react";
import { Box, Text, render } from "ink";
import type { DashboardSnapshot } from "../telemetry/snapshot.js";

const inkColor = { green: "green", yellow: "yellow", orange: "#ff8c00", red: "red", critical: "redBright" } as const;
const duration = (ms?: number): string => ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}s`;
const memory = (used: number, total: number): string => `${Math.round(used)}/${Math.round(total)} MiB`;

export function Dashboard({ snapshot }: { snapshot: DashboardSnapshot }): React.JSX.Element {
  const context = snapshot.context; const gpu = snapshot.machine.gpu;
  return <Box flexDirection="column">
    <Text bold>Local Agent Harness · {snapshot.run.id}</Text>
    <Text>{snapshot.run.repository} [{snapshot.run.branch}] · {duration(snapshot.run.elapsedMs)} · {snapshot.run.stage} · review {snapshot.run.reviewIteration} · {snapshot.run.status}</Text>
    <Text bold>Model</Text><Text>{snapshot.model ? `${snapshot.model.role} · ${snapshot.model.alias} · ${snapshot.model.lifecycle} · ${duration(snapshot.model.requestDurationMs)} · ${snapshot.model.tokensPerSecond?.toFixed(1) ?? "-"} tok/s` : "inactive"}</Text>
    <Text bold>Context</Text><Text color={context ? inkColor[context.level] : undefined}>{context ? `${context.latestPromptTokens}/${context.contextWindow} (${(context.usage * 100).toFixed(1)}%) · ${context.provenance} · projected=${context.projectedTokens ?? "-"} reserve=${context.reservedTokens ?? "-"} handoff=${context.effectiveHandoffThreshold === undefined ? "-" : `${(context.effectiveHandoffThreshold * 100).toFixed(1)}%`}` : "unavailable"}</Text>
    <Text bold>Quality gates</Text>{snapshot.gates.length ? snapshot.gates.map((gate) => <Text key={gate.name}>{gate.name}: {gate.status} · {duration(gate.durationMs)} · exit={gate.exitCode ?? "-"} · baseline={gate.baseline ?? "-"} · provenance={gate.provenance}</Text>) : <Text>not run</Text>}
    <Text bold>Review</Text><Text>total={snapshot.review.total} critical={snapshot.review.severity.critical} high={snapshot.review.severity.high} medium={snapshot.review.severity.medium} low={snapshot.review.severity.low} · confirmed={snapshot.review.confirmed} rejected={snapshot.review.rejected} unresolved={snapshot.review.unresolved} · repository={snapshot.review.groups.repository} requirements={snapshot.review.groups.requirements}</Text>
    <Text>progress={snapshot.review.progress?.decision ?? "-"} · mutation={snapshot.verification.mutation?.status ?? "-"}/{snapshot.verification.mutation?.score ?? "-"} · flaky={snapshot.verification.flaky?.potentially_flaky ?? 0}</Text>
    <Text bold>Machine</Text><Text>GPU {gpu ? `${gpu.utilizationPercent}% · VRAM ${memory(gpu.vramUsedMiB, gpu.vramTotalMiB)} · ${gpu.temperatureC}°C · ${gpu.powerW}W` : "unavailable"} · RAM {memory(snapshot.machine.ram.usedMiB, snapshot.machine.ram.totalMiB)} · swap {memory(snapshot.machine.swap.usedMiB, snapshot.machine.swap.totalMiB)} · llama PID {snapshot.machine.llamaPid ?? "-"}</Text>
    <Text bold>Events</Text>{snapshot.events.length ? snapshot.events.map((event, index) => <Text key={`${event.timestamp}-${index}`}>{event.timestamp} · {event.type} · {event.message}</Text>) : <Text>no events</Text>}
  </Box>;
}

export async function renderDashboard(snapshot: DashboardSnapshot): Promise<void> { const instance = render(<Dashboard snapshot={snapshot} />); instance.unmount(); await instance.waitUntilExit(); }
