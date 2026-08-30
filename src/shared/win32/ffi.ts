/**
 * Raw Win32 bindings used to spawn a process with a real OS security
 * boundary (Job Object containment + AppContainer network denial) instead
 * of the plain `CreateProcess` that `Bun.spawn` performs internally. A
 * child's primary token can only be set at creation time, so genuine
 * network isolation requires driving `CreateProcessW` directly.
 *
 * Struct byte offsets below were derived from the public Win32 headers and
 * verified empirically against this host (see the isolation test suite)
 * rather than assumed from memory alone.
 */
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

export const kernel32 = dlopen("kernel32.dll", {
  CreateFileW: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.ptr,
    ],
    returns: FFIType.ptr,
  },
  CreateProcessW: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.i32,
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
  WaitForSingleObject: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.u32,
  },
  GetExitCodeProcess: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  TerminateProcess: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  GetLastError: { args: [], returns: FFIType.u32 },
  InitializeProcThreadAttributeList: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  UpdateProcThreadAttribute: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
  DeleteProcThreadAttributeList: { args: [FFIType.ptr], returns: FFIType.i32 },
  CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  SetInformationJobObject: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  AssignProcessToJobObject: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  TerminateJobObject: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
}).symbols;

export const userenv = dlopen("userenv.dll", {
  CreateAppContainerProfile: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
  DeriveAppContainerSidFromAppContainerName: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
}).symbols;

/** HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS), read as a signed i32. */
export const HRESULT_ALREADY_EXISTS = -2147024713;

export const JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE = 144;
export const JobObjectExtendedLimitInformation = 9;
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

export const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
export const EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
export const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
export const CREATE_NO_WINDOW = 0x08000000;
export const STARTF_USESTDHANDLES = 0x00000100;
export const GENERIC_WRITE = 0x40000000;
export const GENERIC_READ = 0x80000000;
export const FILE_SHARE_READ = 0x1;
export const FILE_SHARE_WRITE = 0x2;
export const FILE_SHARE_DELETE = 0x4;
export const CREATE_ALWAYS = 2;
export const OPEN_EXISTING = 3;
export const FILE_ATTRIBUTE_NORMAL = 0x80;
export const INFINITE = 0xffffffff;
export const WAIT_TIMEOUT = 0x00000102;

export function wstr(value: string): Uint8Array {
  const buf = new Uint8Array((value.length + 1) * 2);
  const view = new DataView(buf.buffer);
  for (let index = 0; index < value.length; index += 1)
    view.setUint16(index * 2, value.charCodeAt(index), true);
  view.setUint16(value.length * 2, 0, true);
  return buf;
}

/** SECURITY_ATTRIBUTES with `bInheritHandle = TRUE`, for redirected stdio handles. */
export function inheritableSecurityAttributes(): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 24, true);
  view.setBigUint64(8, 0n, true);
  view.setInt32(16, 1, true);
  return buf;
}

/**
 * `bun:ffi` types every `FFIType.ptr` argument as `Pointer` (a branded
 * `number`), but a HANDLE read back out of a struct via `DataView` is a
 * plain `number` at the type level. The runtime accepts a plain number
 * (verified against real Win32 handles throughout this module's test
 * suite); this cast only satisfies the stricter compile-time brand.
 */
export function asPointer(value: number): Pointer {
  return value as unknown as Pointer;
}

export function readHandle(view: DataView, offset: number): Pointer {
  return asPointer(Number(view.getBigUint64(offset, true)));
}

export function ptrOf(buf: Uint8Array): Pointer {
  return ptr(buf);
}
