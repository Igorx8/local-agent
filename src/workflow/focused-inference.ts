import type { AgentRole } from "../opencode/agents.js";

export interface FocusedInferenceRetry {
  role: AgentRole;
  attempt: number;
  maximum: number;
  error: unknown;
}

export async function invokeFocusedInference<T>(options: {
  role: AgentRole;
  retries: number;
  invoke(): Promise<T>;
  onRetry(event: FocusedInferenceRetry): Promise<void>;
  shouldRetry?(error: unknown): boolean;
}): Promise<T> {
  let lastError: unknown;
  const maximum = options.retries + 1;
  for (let index = 0; index < maximum; index++) {
    try {
      return await options.invoke();
    } catch (error) {
      lastError = error;
      if (index + 1 < maximum && (options.shouldRetry?.(error) ?? true)) {
        await options.onRetry({ role: options.role, attempt: index + 2, maximum, error });
      } else break;
    }
  }
  throw lastError;
}
