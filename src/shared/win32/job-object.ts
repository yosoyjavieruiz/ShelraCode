import type { Pointer } from "bun:ffi";
import {
  kernel32,
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE,
  JobObjectExtendedLimitInformation,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  ptrOf,
  asPointer,
} from "./ffi.js";

/**
 * A Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Assigning
 * a spawned process to it means every descendant it creates (nested job
 * membership is inherited automatically, and breakaway is denied by
 * default) is terminated when the job is terminated or its last handle is
 * closed -- something `child.kill()` alone does not provide on Windows,
 * since it only signals the one process it holds a handle to.
 *
 * Verified empirically: killing only the direct child leaves a grandchild
 * process it spawned running indefinitely; terminating the job it was
 * assigned to kills both. See tests/unit/win32-job-object.test.ts.
 */
export class WindowsJob {
  private handle: Pointer | null;

  private constructor(handle: Pointer) {
    this.handle = handle;
  }

  static create(): WindowsJob | null {
    const raw = kernel32.CreateJobObjectW(null, null);
    if (!raw) return null;
    const handle = asPointer(Number(raw));
    const limits = new Uint8Array(JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE);
    new DataView(limits.buffer).setUint32(
      16,
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      true,
    );
    const ok = kernel32.SetInformationJobObject(
      handle,
      JobObjectExtendedLimitInformation,
      ptrOf(limits),
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE,
    );
    if (!ok) {
      kernel32.CloseHandle(handle);
      return null;
    }
    return new WindowsJob(handle);
  }

  /**
   * Call immediately after `CreateProcessW` returns, on a non-suspended
   * process. `CREATE_SUSPENDED` + assign-before-resume was tried and
   * rejected: when the calling process is itself already nested inside an
   * ambient job (common under sandboxed dev-tool harnesses), that ordering
   * non-deterministically prevented the child from spawning grandchildren
   * at all. Immediate post-spawn assignment on a running process did not
   * reproduce that failure in the same environment.
   */
  assign(processHandle: Pointer): boolean {
    if (this.handle === null) return false;
    return Boolean(
      kernel32.AssignProcessToJobObject(this.handle, processHandle),
    );
  }

  /** Kills every process currently in the job, including descendants. */
  terminate(exitCode = 1): void {
    if (this.handle === null) return;
    kernel32.TerminateJobObject(this.handle, exitCode);
  }

  close(): void {
    if (this.handle === null) return;
    kernel32.CloseHandle(this.handle);
    this.handle = null;
  }
}
