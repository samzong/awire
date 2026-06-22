import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "awire-css-"));
const cssPath = join(dir, "panel.css");

try {
  execFileSync("pnpm", [
    "exec",
    "tailwindcss",
    "-i",
    "src/panel/tailwind.css",
    "-o",
    cssPath,
    "--minify",
  ], {
    env: { ...process.env, BROWSERSLIST_IGNORE_OLD_DATA: "1" },
    stdio: "inherit",
  });

  const css = readFileSync(cssPath, "utf8");
  writeFileSync("src/panel/generated-css.ts", `export const PANEL_CSS = ${JSON.stringify(css)};\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
