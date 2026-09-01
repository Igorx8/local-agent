export type ModelLifecycleState = "stopped" | "loading" | "healthy" | "generating" | "unloading" | "error";
export interface ModelStatus { alias?: string; state: ModelLifecycleState; pid?: number; detail?: string; }
export interface ModelLifecycle {
  ensureModel(alias: string): Promise<ModelStatus>;
  beginRequest(alias: string): void;
  endRequest(alias: string): void;
  stop(): Promise<ModelStatus>;
  status(): ModelStatus;
}

export class ActiveModelRequestError extends Error {}
