#!/usr/bin/env bash
# Idempotent web toolchain for Cursor cloud agents.
# The Exact commit comes from .exact-ref.
# Bun, Rust, Hermes, wasm-bindgen and Binaryen versions are read from that Exact checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '==> %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

EXACT_REF="$(tr -d '[:space:]' < .exact-ref)"
if [[ ! "$EXACT_REF" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not read a 40-character commit from .exact-ref (got '${EXACT_REF:-}')" >&2
  exit 1
fi

export EXACT_FEEDBACK=0

if [[ -x /usr/bin/google-chrome ]]; then
  CHROME_BIN=/usr/bin/google-chrome
elif [[ -x /usr/bin/google-chrome-stable ]]; then
  CHROME_BIN=/usr/bin/google-chrome-stable
elif [[ -x /usr/local/bin/google-chrome ]]; then
  CHROME_BIN=/usr/local/bin/google-chrome
else
  log "installing Google Chrome"
  sudo install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y google-chrome-stable
  CHROME_BIN=/usr/bin/google-chrome
fi
export CHROME="$CHROME_BIN"

# Login shells (install, start, and later agents) do not read ~/.bashrc.
sudo tee /etc/profile.d/exact-solar-trial.sh >/dev/null <<EOF
export EXACT_FEEDBACK=0
export CHROME=${CHROME_BIN}
EOF
sudo chmod 644 /etc/profile.d/exact-solar-trial.sh

if ! dpkg -s pkg-config >/dev/null 2>&1; then
  log "installing pkg-config"
  sudo apt-get update
  sudo apt-get install -y pkg-config
fi

PARENT="$(cd "$ROOT/.." && pwd -P)"
PARENT="${PARENT%/}"
EXACT="${PARENT}/exact"
log "Exact checkout ${EXACT} @ ${EXACT_REF}"
if [[ ! -d "$EXACT" ]]; then
  if ! mkdir -p "$EXACT" 2>/dev/null; then
    sudo mkdir -p "$EXACT"
    sudo chown "$(id -u):$(id -g)" "$EXACT"
  fi
fi
if [[ -e "$EXACT" && ! -d "$EXACT/.git" && -n "$(ls -A "$EXACT" 2>/dev/null || true)" ]]; then
  echo "Refusing to replace ${EXACT}: it exists and is not a git checkout" >&2
  exit 1
fi
if [[ ! -d "$EXACT/.git" ]]; then
  git -C "$EXACT" init -q
  git -C "$EXACT" remote add origin https://github.com/expo/exact.git
fi
if [[ "$(git -C "$EXACT" rev-parse HEAD 2>/dev/null || true)" != "$EXACT_REF" ]]; then
  log "fetching Exact ${EXACT_REF}"
  git -C "$EXACT" fetch --depth 1 origin "$EXACT_REF"
  git -C "$EXACT" -c advice.detachedHead=false checkout --force --detach FETCH_HEAD
fi
if [[ "$(git -C "$EXACT" rev-parse HEAD)" != "$EXACT_REF" ]]; then
  echo "Exact checkout is $(git -C "$EXACT" rev-parse HEAD), wanted ${EXACT_REF}" >&2
  exit 1
fi
bash "$ROOT/scripts/normalize-mtimes.sh" "$EXACT"

# The Bun version is Exact's own pin (packageManager in its package.json).
BUN_VERSION="$(sed -n -E 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' "$EXACT/package.json" | head -n 1)"
if [[ -z "$BUN_VERSION" ]]; then
  echo "Could not read the Bun version from ${EXACT}/package.json (packageManager)" >&2
  exit 1
fi
BUN_HOME="${HOME}/.bun-${BUN_VERSION}"
if [[ ! -x "${BUN_HOME}/bin/bun" ]] || [[ "$("${BUN_HOME}/bin/bun" --version)" != "$BUN_VERSION" ]]; then
  log "installing Bun ${BUN_VERSION}"
  curl -fsSL https://bun.sh/install | BUN_INSTALL="$BUN_HOME" bash -s "bun-v${BUN_VERSION}"
fi
sudo ln -sfn "${BUN_HOME}/bin/bun" /usr/local/bin/bun
export PATH="${BUN_HOME}/bin:${PATH}"
hash -r

if [[ ! -d "$EXACT/node_modules" ]]; then
  log "bun install in Exact"
  (cd "$EXACT" && bun install --frozen-lockfile)
else
  log "Exact node_modules present; refreshing lockfile install"
  (cd "$EXACT" && bun install --frozen-lockfile)
fi

log "Rust toolchains from the Exact checkout"
bun -e '
  const exact = process.argv[1];
  const toolchain = Bun.TOML.parse(await Bun.file(`${exact}/rust-toolchain.toml`).text()).toolchain;
  const app = await Bun.file(`${exact}/scripts/app.mjs`).text();
  const marker = "export const WEB_TOOLCHAIN = ";
  const at = app.indexOf(marker);
  if (at < 0) throw new Error("WEB_TOOLCHAIN missing from scripts/app.mjs");
  const quote = app[at + marker.length];
  const end = app.indexOf(quote + ";", at + marker.length + 1);
  const nightly = app.slice(at + marker.length + 1, end);
  if (!nightly) throw new Error("WEB_TOOLCHAIN missing from scripts/app.mjs");
  const stable = [
    "toolchain", "install", toolchain.channel, "--profile", toolchain.profile ?? "minimal",
    ...(toolchain.components ?? []).flatMap((c) => ["--component", c]),
    ...(toolchain.targets ?? []).flatMap((t) => ["--target", t]),
  ];
  const night = ["toolchain", "install", nightly, "--profile", "minimal", "--component", "rust-src", "--component", "clippy", "--target", "wasm32-unknown-unknown"];
  for (const args of [stable, night]) {
    const result = Bun.spawnSync(["rustup", ...args], { stdout: "inherit", stderr: "inherit" });
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  }
  const sysroot = Bun.spawnSync(["rustc", `+${nightly}`, "--print", "sysroot"], { stdout: "pipe", stderr: "inherit" });
  if (sysroot.exitCode !== 0) process.exit(sysroot.exitCode ?? 1);
  const library = `${sysroot.stdout.toString().trim()}/lib/rustlib/src/rust/library/Cargo.toml`;
  const fetched = Bun.spawnSync(["cargo", `+${nightly}`, "fetch", "--locked", "--manifest-path", library], { stdout: "inherit", stderr: "inherit" });
  if (fetched.exitCode !== 0) process.exit(fetched.exitCode ?? 1);
' "$EXACT"

log "wasm-bindgen"
bun -e '
  const exact = process.argv[1];
  const pin = Bun.TOML.parse(await Bun.file(`${exact}/rust-toolchain.toml`).text()).toolchain.channel;
  const raw = Bun.TOML.parse(await Bun.file(`${exact}/game/Cargo.toml`).text()).workspace.dependencies["wasm-bindgen"];
  if (typeof raw !== "string") throw new Error("wasm-bindgen pin missing");
  const version = raw.replace(/^=/, "");
  const located = Bun.spawnSync(["bash", "-lc", "command -v wasm-bindgen"], { stdout: "pipe" });
  if (located.exitCode === 0) {
    const have = Bun.spawnSync(["wasm-bindgen", "--version"], { stdout: "pipe" });
    if (have.exitCode === 0 && have.stdout.toString().trim() === `wasm-bindgen ${version}`) {
      console.log(`wasm-bindgen ${version} already installed`);
      process.exit(0);
    }
  }
  const result = Bun.spawnSync(["cargo", `+${pin}`, "install", "wasm-bindgen-cli", "--version", version, "--locked", "--force"], { stdout: "inherit", stderr: "inherit" });
  process.exit(result.exitCode ?? 1);
' "$EXACT"

log "Binaryen"
bun -e '
  import { createHash } from "node:crypto";
  import { spawnSync } from "node:child_process";
  import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
  import { tmpdir, homedir } from "node:os";
  import { resolve } from "node:path";
  const exact = process.argv[1];
  const source = await Bun.file(`${exact}/host/web/stages.mjs`).text();
  const marker = "export const BINARYEN = ";
  const at = source.indexOf(marker);
  if (at < 0) throw new Error("BINARYEN pin missing");
  const quote = source[at + marker.length];
  const end = source.indexOf(quote + ";", at + marker.length + 1);
  const pinned = source.slice(at + marker.length + 1, end);
  if (!pinned) throw new Error("BINARYEN pin missing");
  const tag = pinned.replace(" ", "_");
  const platform = process.platform === "linux" ? "linux" : process.platform === "darwin" ? "macos" : null;
  const cpu = process.arch === "x64" ? "x86_64" : process.arch === "arm64" && process.platform === "linux" ? "aarch64" : process.arch === "arm64" ? "arm64" : null;
  if (!platform || !cpu) throw new Error(`no Binaryen archive for ${process.platform}/${process.arch}`);
  const dest = resolve(homedir(), ".cache/exact/binaryen", tag);
  const have = spawnSync(resolve(dest, "bin/wasm-opt"), ["--version"], { encoding: "utf8" });
  if (have.status === 0 && have.stdout.includes(pinned)) {
    console.log(`wasm-opt ${pinned} already installed`);
    process.exit(0);
  }
  const name = `binaryen-${tag}-${cpu}-${platform}.tar.gz`;
  const url = `https://github.com/WebAssembly/binaryen/releases/download/${tag}/${name}`;
  const stage = mkdtempSync(resolve(tmpdir(), "exact-binaryen-"));
  try {
    const archive = resolve(stage, name);
    const sum = `${archive}.sha256`;
    for (const [out, from] of [[archive, url], [sum, `${url}.sha256`]]) {
      const curl = spawnSync("curl", ["-fL", "--retry", "3", "-o", out, from], { stdio: "inherit" });
      if (curl.status !== 0) process.exit(curl.status ?? 1);
    }
    const expected = readFileSync(sum, "utf8").trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (actual !== expected) throw new Error("Binaryen checksum mismatch");
    mkdirSync(dest, { recursive: true });
    const tar = spawnSync("tar", ["-xzf", archive, "--strip-components=1", "-C", dest], { stdio: "inherit" });
    if (tar.status !== 0) process.exit(tar.status ?? 1);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
' "$EXACT"

INSTALLER="$EXACT/vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml"
log "Hermes bundles"
if ! (cd "$EXACT" && cargo run --locked --offline --manifest-path "$INSTALLER" -- --check); then
  log "installing attested Hermes bundles"
  (cd "$EXACT" && cargo run --locked --manifest-path "$INSTALLER" --)
fi

log "cargo fetch (Exact, then this app)"
(cd "$EXACT" && cargo fetch --locked)
(cd "$ROOT" && cargo fetch --locked)

log "warm bun exact.mjs test web"
test_started=$SECONDS
(cd "$ROOT" && bun exact.mjs test web)
echo "TIMING test_web $((SECONDS - test_started))s"
log "install complete"
