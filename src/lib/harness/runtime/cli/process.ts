import { spawn } from "node:child_process";
import type { ChildProcessHandle, SignalProcessGroup, SpawnCliProcess } from "./types";

export const spawnCliProcess: SpawnCliProcess = (executable, args, options) => {
  const child = spawn(executable, [...args], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  if (!child.stdout || !child.stderr) throw new Error("CLI process streams are unavailable");
  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
  };
};

export const signalProcessGroup: SignalProcessGroup = (pid, signal) => {
  process.kill(process.platform === "win32" ? pid : -pid, signal);
};

export async function terminateProcessGroup(
  processHandle: Pick<ChildProcessHandle, "pid" | "exit">,
  options: { graceMs: number; signal?: SignalProcessGroup },
): Promise<void> {
  if (!processHandle.pid) throw new Error("Cannot terminate a CLI process without a pid");
  const send = options.signal ?? signalProcessGroup;
  let exited = false;
  void processHandle.exit.then(() => { exited = true; }, () => { exited = true; });
  try { send(processHandle.pid, "SIGTERM"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return;
  }
  await Promise.race([processHandle.exit.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, options.graceMs))]);
  if (!exited) {
    try { send(processHandle.pid, "SIGKILL"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await processHandle.exit.catch(() => undefined);
  }
}
