import pino from "pino";
import pretty from "pino-pretty";

const level = "info";
const prettyStream = pretty({
  colorize: true,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
  ignore: "pid,hostname",
  singleLine: true,
});

// Swallow EPIPE on stdout/stderr so that a closed pipe (e.g. the daemon
// was launched with its output piped to a consumer that exited, or the
// parent closed the pipe during shutdown) does not surface as a fatal
// uncaught exception. This fires from pino's stream write during
// `log.info(...)` inside shutdown (see ODE-DEAMON-6). EPIPE is a
// well-known Node.js gotcha; we quietly detach the listener so further
// writes are no-ops instead of crashing the process.
function installPipeErrorGuard(stream: NodeJS.WriteStream, name: string): void {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err && err.code === "EPIPE") {
      // Nothing we can do; further writes would just throw again.
      return;
    }
    // Surface other stream errors on stderr (best-effort) but do not
    // rethrow — the stream is toast either way.
    try {
      process.stderr.write(`logger: ${name} stream error: ${String(err)}\n`);
    } catch {
      // Ignore; stderr itself may be the broken pipe.
    }
  });
}
installPipeErrorGuard(process.stdout, "stdout");
installPipeErrorGuard(process.stderr, "stderr");

export const logger = pino(
  { level },
  process.stdout.isTTY ? prettyStream : undefined,
);

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => logger.info(data, msg),
  error: (msg: string, data?: Record<string, unknown>) => logger.error(data, msg),
  warn: (msg: string, data?: Record<string, unknown>) => logger.warn(data, msg),
  debug: (msg: string, data?: Record<string, unknown>) => logger.debug(data, msg),
};
