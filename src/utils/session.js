import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

const SESSION_DIR = resolve(homedir(), ".rxs-code-sessions");

if (!existsSync(SESSION_DIR)) {
  mkdirSync(SESSION_DIR, { recursive: true });
}

export class SessionManager {
  constructor(name = "default") {
    this.name = name;
    this.filePath = resolve(SESSION_DIR, `${name}.json`);
  }

  async save(history) {
    await fs.writeFile(this.filePath, JSON.stringify(history, null, 2), "utf8");
  }

  async load() {
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }

  async listSessions() {
    try {
      const files = await fs.readdir(SESSION_DIR);
      return files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
    } catch (e) {
      return [];
    }
  }

  async delete() {
    try {
      await fs.unlink(this.filePath);
    } catch (e) {
      // ignore
    }
  }
}
