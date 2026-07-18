import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export const CHATTO_PROTO_TAG = "v0.4.13";

const archiveUrl = `https://github.com/chattocorp/chatto/archive/refs/tags/${CHATTO_PROTO_TAG}.tar.gz`;
const projectRoot = join(import.meta.dir, "..");
const workRoot = join(projectRoot, ".tmp", `chatto-${CHATTO_PROTO_TAG}`);
const archivePath = join(workRoot, "chatto.tar.gz");
const extractRoot = join(workRoot, "extract");
const protoTarget = join(projectRoot, "proto");
const includedPackages = ["discovery", "auth", "api", "realtime", "admin"];

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`${command[0]} exited with code ${exitCode}`);
}

await rm(workRoot, { recursive: true, force: true });
await mkdir(extractRoot, { recursive: true });

const response = await fetch(archiveUrl);
if (!response.ok) throw new Error(`Unable to download ${archiveUrl}: ${response.status} ${response.statusText}`);
await Bun.write(archivePath, response);
const archiveRoot = `chatto-${CHATTO_PROTO_TAG.slice(1)}`;
await run(["tar", "-xzf", archivePath, "-C", extractRoot, `${archiveRoot}/proto`]);

const [sourceDirectory] = await readdir(extractRoot);
if (!sourceDirectory) throw new Error("Downloaded Chatto archive was empty");
const protoSource = join(extractRoot, sourceDirectory, "proto");

await rm(protoTarget, { recursive: true, force: true });
await mkdir(join(protoTarget, "chatto"), { recursive: true });

for (const packageName of includedPackages) {
  await cp(join(protoSource, "chatto", packageName), join(protoTarget, "chatto", packageName), {
    recursive: true,
  });
  await rm(join(protoTarget, "chatto", packageName, "v1", "AGENTS.md"), { force: true });
}

for (const metadataFile of ["buf.yaml", "buf.lock"]) {
  await cp(join(protoSource, metadataFile), join(protoTarget, metadataFile));
}

await Bun.write(
  join(protoTarget, "UPSTREAM.md"),
  `# Vendored Chatto protocol definitions\n\nSource: https://github.com/chattocorp/chatto/tree/${CHATTO_PROTO_TAG}/proto\n\nPinned tag: ${CHATTO_PROTO_TAG}\n\nIncluded Apache-2.0 packages: admin, api, auth, discovery, realtime.\nInternal core/config and Unix-socket-only operator definitions are excluded.\n\nLicense boundary: https://github.com/chattocorp/chatto/blob/${CHATTO_PROTO_TAG}/REUSE.toml\n`,
);

await rm(workRoot, { recursive: true, force: true });
console.log(`Vendored Chatto protocol definitions from ${CHATTO_PROTO_TAG}`);
