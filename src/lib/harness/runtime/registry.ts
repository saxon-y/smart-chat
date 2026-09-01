import type { TaskEnvelope } from "../protocol";
import { HarnessRuntimeError } from "../protocol";
import type { AgentRuntime } from "./types";

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();

  register(runtime: AgentRuntime) {
    if (this.runtimes.has(runtime.id)) throw new Error(`runtime_already_registered:${runtime.id}`);
    this.runtimes.set(runtime.id, runtime);
  }

  get(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new HarnessRuntimeError("runtime_not_found", "RUNTIME", false, true);
    return runtime;
  }

  async resolve(task: TaskEnvelope) {
    const runtime = this.get(task.runtime.id);
    const available = await runtime.capabilities();
    const missing = task.runtime.requiredCapabilities.filter((capability) => !available.capabilities.includes(capability));
    if (missing.length) throw new HarnessRuntimeError("runtime_capability_mismatch", "RUNTIME", false, true);
    return runtime;
  }
}
