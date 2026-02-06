const isNodeRuntime =
  typeof process !== "undefined" &&
  typeof process.versions === "object" &&
  Boolean(process.versions.node);

const homeDir = isNodeRuntime
  ? process.env.HOME || process.env.USERPROFILE || ""
  : "";

const cwd = isNodeRuntime && typeof process.cwd === "function" ? process.cwd() : "/";

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

function isAbsolutePath(input: string): boolean {
  return input.startsWith("/") || input.startsWith("\\") || WINDOWS_DRIVE_PATH.test(input);
}

function normalizePath(input: string): string {
  if (!input) return "/";

  const normalized = input.replace(/\\/g, "/");
  const hasDrivePrefix = WINDOWS_DRIVE_PATH.test(normalized);
  const drivePrefix = hasDrivePrefix ? normalized.slice(0, 2) : "";
  const withoutDrive = hasDrivePrefix ? normalized.slice(2) : normalized;
  const isAbsolute = withoutDrive.startsWith("/");
  const segments = withoutDrive.split("/");
  const stack: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }

  const body = stack.join("/");
  const prefix = `${drivePrefix}${isAbsolute ? "/" : ""}`;
  const output = `${prefix}${body}`;

  if (output) return output;
  if (drivePrefix) return `${drivePrefix}/`;
  return isAbsolute ? "/" : ".";
}

function resolvePath(basePath: string, input: string): string {
  if (isAbsolutePath(input)) return normalizePath(input);
  return normalizePath(`${basePath.replace(/\\/g, "/")}/${input}`);
}

export function normalizeCwd(input: string): string {
  if (!input) return cwd;
  if (input === "~") return homeDir || cwd;
  if (input.startsWith("~/")) {
    return resolvePath(homeDir || cwd, input.slice(2));
  }
  return resolvePath(cwd, input);
}
