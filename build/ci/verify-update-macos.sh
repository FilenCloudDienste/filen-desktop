#!/usr/bin/env bash
# Auto-update end-to-end check on macOS.
#
# Extracts the candidate zip to a writable location, then serves the REAL latest-mac.yml back to it
# with only the version rewritten to 9.9.9 (Squirrel validates signatures, not versions), together
# with both zips it lists - so MacUpdater's arch filtering and zip-over-dmg selection run against
# the production manifest shape, not a synthetic one. With FILEN_E2E_UPDATER=1 the app consumes the
# loopback feed and confirms the install without a user click (one-shot via FILEN_E2E_ONCE_FILE).
# Success means the full production pipeline ran on this arch: check -> arch/file selection ->
# download -> Squirrel staging (proxy download, extraction, signature verification) -> ShipIt
# bundle swap -> relaunch. A reintroduced exit-timer race (the v3.0.46-v3.0.50 class) hangs this
# check red instead of shipping.
#
# Usage: verify-update-macos.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"
FEED_PORT=8124
APP_DIR="$HOME/filen-e2e"
APP="$APP_DIR/Filen.app"
LOG_FILE="$HOME/Library/Application Support/@filen/logs/desktop.log"
APP_OUT="$(mktemp /tmp/filen-e2e-out.XXXXXX)"
ONCE_FILE="$(mktemp -u /tmp/filen-e2e-once.XXXXXX)"
SERVER_PID=""

fail() {
	echo "FAIL: $1"
	if [ -f "$LOG_FILE" ]; then
		echo "--- desktop.log updater lines ---"
		grep -iE "updater|update|installing" "$LOG_FILE" | tail -n 60 || true
	fi
	echo "--- app stdout/stderr tail ---"
	tail -n 40 "$APP_OUT" || true
	exit 1
}

cleanup() {
	pkill -f "$APP_DIR" >/dev/null 2>&1 || true
	[ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1 || true
	rm -f "$ONCE_FILE"
}
trap cleanup EXIT

# 1. Install the candidate where ShipIt can swap it.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
ditto -x -k "prod/Filen_mac_${ARCH}.zip" "$APP_DIR"
[ -d "$APP" ] || fail "candidate app missing after extraction"

# 2. Loopback feed: the REAL manifest, version rewritten to 9.9.9, plus both zips it lists.
FEED_DIR="$(mktemp -d /tmp/filen-feed.XXXXXX)"
sed -E 's/^version:.*$/version: 9.9.9/' prod/latest-mac.yml > "$FEED_DIR/latest-mac.yml"
cp prod/Filen_mac_x64.zip prod/Filen_mac_arm64.zip "$FEED_DIR/"

python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$FEED_DIR" >/dev/null 2>&1 &
SERVER_PID=$!

READY=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	if curl -sf --max-time 3 "http://127.0.0.1:${FEED_PORT}/latest-mac.yml" >/dev/null 2>&1; then
		READY=1
		break
	fi
	sleep 1
done
[ -n "$READY" ] || fail "loopback feed server did not become ready on port $FEED_PORT"

# 3. Launch in E2E updater mode and record the binary's identity for swap detection.
rm -f "$LOG_FILE"
INODE_BEFORE="$(stat -f %i "$APP/Contents/MacOS/Filen")"
FILEN_E2E_UPDATER=1 FILEN_E2E_UPDATE_FEED="http://127.0.0.1:${FEED_PORT}/" FILEN_E2E_ONCE_FILE="$ONCE_FILE" \
	"$APP/Contents/MacOS/Filen" >"$APP_OUT" 2>&1 &
ORIGINAL_PID=$!

# E2E engagement must be provable early - a rejected feed override would otherwise poll the
# production CDN and burn the whole timeout.
ENGAGED=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
	sleep 5
	if [ -f "$LOG_FILE" ] && grep -q "Updater E2E mode enabled" "$LOG_FILE"; then
		ENGAGED=1
		break
	fi
done
[ -n "$ENGAGED" ] || fail "E2E feed override did not engage within 60s"

# 4. Wait for: Squirrel staging -> ShipIt swap (inode changes) -> relaunch (new pid, old pid gone).
DEADLINE=$((SECONDS + 900))
SWAPPED=""
RELAUNCHED=""
NEW_PID=""
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

# The original process must actually be gone (ShipIt swaps only after parent exit; assert it).
kill -0 "$ORIGINAL_PID" 2>/dev/null && fail "original app process (pid $ORIGINAL_PID) is still alive after the swap"

# Relaunch liveness: the process must survive beyond its first seconds.
sleep 15
kill -0 "$NEW_PID" 2>/dev/null || fail "relaunched app (pid $NEW_PID) died shortly after starting"
pkill -f "$APP_DIR" >/dev/null 2>&1 || true

grep -q "Update downloaded" "$LOG_FILE" || fail "desktop.log has no 'Update downloaded' entry"
grep -q "Installing update" "$LOG_FILE" || fail "desktop.log has no 'Installing update' entry"
# MacUpdater must have selected this arch's zip from the production-shaped manifest.
grep -q "Filen_mac_${ARCH}.zip" "$LOG_FILE" || fail "desktop.log never mentions Filen_mac_${ARCH}.zip - the updater selected a different file than real $ARCH clients would"

# 5. The swapped bundle must still verify - Squirrel installed what we served.
codesign --verify --deep --strict "$APP" || fail "swapped bundle fails codesign verification"

echo "verify-update-macos PASSED for $ARCH"
