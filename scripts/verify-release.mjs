import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const tag = process.env.RELEASE_TAG ?? "";
const semver = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!semver.test(tag)) fail(`Invalid SemVer release tag: ${tag}`);

const version = tag.slice(1);
const generateOnly = process.argv[2] === "--generate";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
if (manifest.version !== version) {
  fail(`package.json version ${manifest.version} does not match ${version}`);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (!generateOnly && git("rev-parse", "HEAD") !== git("rev-parse", `refs/tags/${tag}^{commit}`)) {
  fail(`HEAD does not match ${tag}`);
}

let section;
let date = new Date().toISOString().slice(0, 10);
if (!generateOnly) {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const sections = changelog.split(/(?=^## \[)/m);
  const matches = sections.filter((entry) => entry.startsWith(`## [${version}] - `));
  if (matches.length !== 1) fail(`Expected one CHANGELOG.md section for ${version}`);

  section = matches[0].split(/^\[(?:Unreleased|[0-9][^\]]*)\]:/m)[0].trim();
  date = section.split("\n")[0].slice(`## [${version}] - `.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    fail(`Invalid release date: ${date}`);
  }
}

const previousStable = git("tag", "--merged", "HEAD", "--sort=-version:refname").split("\n")
  .find((entry) => entry !== tag && /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(entry));
const range = previousStable ? `${previousStable}..HEAD` : "HEAD";
const generated = execFileSync("git-cliff", ["--config", "cliff.toml", "--ignore-tags", ".*", "--tag", tag, "--strip", "all", range], {
  encoding: "utf8",
  env: { ...process.env, RELEASE_DATE: date },
}).trim();
if (!/^- .+/m.test(generated)) fail("git-cliff produced empty release notes");
if (generateOnly) {
  console.log(generated);
  process.exit(0);
}
if (section !== generated) fail(`CHANGELOG.md section for ${version} differs from git-cliff`);

const notesPath = process.argv[2];
if (notesPath) writeFileSync(notesPath, `${section}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `is_prerelease=${version.includes("-")}\n`);
}
console.log(`Release gate passed: ${tag}`);
