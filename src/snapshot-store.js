import fs from "node:fs";
import path from "node:path";

export class SnapshotStore {
  constructor(directory = path.resolve("data")) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  append(kind, payload) {
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(this.directory, `${kind}-${day}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...payload })}\n`);
  }
}
