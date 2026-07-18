import { rm } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
await rm(join(projectRoot, "src", "gen"), { recursive: true, force: true });

const process = Bun.spawn(["buf", "generate", "proto", "--include-imports"], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await process.exited;
if (exitCode !== 0) throw new Error(`buf generate exited with code ${exitCode}`);
