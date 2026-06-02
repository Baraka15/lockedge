import fs from "node:fs";
import path from "node:path";

const LOG_DIR = "logs";
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const today = () => new Date().toISOString().slice(0, 10);
let stream = fs.createWriteStream(path.join(LOG_DIR, `bot-${today()}.log`), { flags: "a" });
let streamDay = today();

function rotate() {
  if (streamDay !== today()) {
    stream.end();
    stream = fs.createWriteStream(path.join(LOG_DIR, `bot-${today()}.log`), { flags: "a" });
    streamDay = today();
  }
}

function write(level, msg, extra) {
  rotate();
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`;
  stream.write(line + "\n");
  // eslint-disable-next-line no-console
  console.log(line);
}

export const log = {
  info: (m, e) => write("INFO", m, e),
  warn: (m, e) => write("WARN", m, e),
  error: (m, e) => write("ERROR", m, e),
};