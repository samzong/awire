import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "local";
  }
}

const ldflags = [
  `-X github.com/lathe-cli/lathe/pkg/lathe.Version=${version}`,
  `-X github.com/lathe-cli/lathe/pkg/lathe.Commit=${gitCommit()}`,
  `-X github.com/lathe-cli/lathe/pkg/lathe.Date=${new Date().toISOString().slice(0, 10)}`,
].join(" ");

execFileSync(
  "go",
  ["build", "-o", "bin/awirectl", `-ldflags=${ldflags}`, "./cmd/awirectl"],
  { cwd: join(root, "cli"), stdio: "inherit" },
);