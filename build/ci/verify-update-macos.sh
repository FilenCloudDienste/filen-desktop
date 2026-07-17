#!/usr/bin/env bash
# Auto-update end-to-end check on macOS.
#
# Extracts the candidate zip to a writable location, then serves the same zip back to it from a
# loopback feed claiming version 9.9.9 (Squirrel.Mac validates signatures, not versions, so the
# candidate can play its own successor). With FILEN_E2E_UPDATER=1 the app consumes the loopback
# feed and confirms the install without a user click (src/lib/updater.ts). Success means the full
# production pipeline ran on this arch: check -> download -> Squirrel staging (proxy download,
# extraction, signature verification) -> ShipIt bundle swap -> relaunch. This is the flow the
# v3.0.46-v3.0.50 exit-timer race silently broke - a regression there hangs this check.
#
# Usage: verify-update-macos.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"
FEED_PORT=8124
APP_DIR="$HOME/filen-e2e"
APP="$APP_DIR/Filen.app"
LOG_FILE="$HOME/Library/Application Support/@filen/logs/desktop.log"
SERVER_PID=""

fail() {
	echo "FAIL: $1"
	if [ -f "$LOG_FILE" ]; then
		echo "--- desktop.log tail ---"
		tail -n 40 "$LOG_FILE"
	fi
	exit 1
}

cleanup() {
	pkill -f "$APP_DIR" >/dev/null 2>&1 || true
	[ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. Install the candidate where ShipIt can swap it.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
ditto -x -k "prod/Filen_mac_${ARCH}.zip" "$APP_DIR"
[ -d "$APP" ] || fail "candidate app missing after extraction"

# 2. Loopback feed: the candidate zip under its production name, manifest claiming 9.9.9.
FEED_DIR="$(mktemp -d /tmp/filen-feed.XXXXXX)"
cp "prod/Filen_mac_${ARCH}.zip" "$FEED_DIR/Filen_mac_${ARCH}.zip"
SHA512="$(openssl dgst -sha512 -binary "$FEED_DIR/Filen_mac_${ARCH}.zip" | base64)"
SIZE="$(stat -f %z "$FEED_DIR/Filen_mac_${ARCH}.zip")"
cat > "$FEED_DIR/latest-mac.yml" <<EOF
version: 9.9.9
minimumSystemVersion: 21.0.0
files:
  - url: Filen_mac_${ARCH}.zip
    sha512: ${SHA512}
    size: ${SIZE}
path: Filen_mac_${ARCH}.zip
sha512: ${SHA512}
releaseDate: '2026-01-01T00:00:00.000Z'
EOF

python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$FEED_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 1

# 3. Launch in E2E updater mode and record the binary's identity for swap detection.
rm -f "$LOG_FILE"
INODE_BEFORE="$(stat -f %i "$APP/Contents/MacOS/Filen")"
FILEN_E2E_UPDATER=1 FILEN_E2E_UPDATE_FEED="http://127.0.0.1:${FEED_PORT}/" "$APP/Contents/MacOS/Filen" >/dev/null 2>&1 &
ORIGINAL_PID=$!

# 4. Wait for: Squirrel staging -> ShipIt swap (inode changes) -> relaunch (new pid on the same path).
DEADLINE=$((SECONDS + 300))
SWAPPED=""
RELAUNCHED=""
while [ $SECONDS -lt $DEADLINE ]; do
	sleep 5

	if [ -z "$SWAPPED" ] && [ -x "$APP/Contents/MacOS/Filen" ]; then
		INODE_NOW="$(stat -f %i "$APP/Contents/MacOS/Filen" 2>/dev/null || echo "$INODE_BEFORE")"
		if [ "$INODE_NOW" != "$INODE_BEFORE" ]; then
			SWAPPED=1
			echo "ShipIt swapped the app bundle (inode $INODE_BEFORE -> $INODE_NOW)"
		fi
	fi

	if [ -n "$SWAPPED" ]; then
		NEW_PID="$(pgrep -f "$APP_DIR/Filen.app/Contents/MacOS/Filen" | head -1 || true)"
		if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$ORIGINAL_PID" ]; then
			RELAUNCHED=1
			echo "App relaunched after update (pid $NEW_PID)"
			break
		fi
	fi
done

[ -n "$SWAPPED" ] || fail "ShipIt never swapped the bundle within the timeout - Squirrel staging did not complete"
[ -n "$RELAUNCHED" ] || fail "app did not relaunch after the ShipIt swap"

grep -q "Update downloaded" "$LOG_FILE" || fail "desktop.log has no 'Update downloaded' entry"
grep -q "Installing update" "$LOG_FILE" || fail "desktop.log has no 'Installing update' entry"

# 5. The swapped bundle must still verify - Squirrel installed what we served.
codesign --verify --deep --strict "$APP" || fail "swapped bundle fails codesign verification"

echo "verify-update-macos PASSED for $ARCH"
