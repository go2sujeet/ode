import pino from "pino";
import pretty from "pino-pretty";

const level = "info";
const prettyStream = pretty({
  colorize: true,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
  ignore: "pid,hostname",
});

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
