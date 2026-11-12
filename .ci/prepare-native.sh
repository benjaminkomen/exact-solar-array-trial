#!/bin/sh
# Prepares an Exact native build on an EAS worker (or any clean machine).
# Usage: sh .ci/prepare-native.sh ios|android
# Follows Exact's "Native CI preparation" recipe. The Exact commit comes from
# EXACT_REF, or else from .exact-ref at the repo root. Bun must already be on
# PATH at the version Exact asks for (eas.json "bun").
set -eu
EXACT_REF="${EXACT_REF:-$(tr -d '[:space:]' < .exact-ref)}"
EXACT="$PWD/../exact"; export EXACT
# init + fetch (not clone): a restored Exact target/ may already sit in the folder.
mkdir -p "$EXACT"
if [ ! -d "$EXACT/.git" ]; then
  git -C "$EXACT" init -q
  git -C "$EXACT" remote add origin https://github.com/expo/exact.git
fi
git -C "$EXACT" fetch -q --depth 1 origin "$EXACT_REF"
git -C "$EXACT" checkout -q --detach FETCH_HEAD
git -C "$EXACT" log --oneline -1
bun install --frozen-lockfile --cwd "$EXACT"
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/exact-rustup.sh
  sh /tmp/exact-rustup.sh -y --profile minimal --default-toolchain none --no-modify-path
fi
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
pin=$(bun -e 'console.log(Bun.TOML.parse(await Bun.file(process.env.EXACT + "/rust-toolchain.toml").text()).toolchain.channel)')
case "$1" in
  ios) triple=aarch64-apple-ios ;;
  android) triple=aarch64-linux-android ;;
  *) echo "usage: prepare-native.sh ios|android" >&2; exit 2 ;;
esac
rustup toolchain install "$pin" --profile minimal --target "$triple"
cargo +"$pin" run --locked --manifest-path "$EXACT/vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml" -- --target "$triple"
if command -v set-env >/dev/null 2>&1; then
  set-env EXACT "$EXACT"
  set-env PATH "$PATH"
fi
