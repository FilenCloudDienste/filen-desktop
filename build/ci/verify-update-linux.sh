#!/usr/bin/env bash
# Auto-update end-to-end check for the AppImage - the Linux format whose auto-update replaces the
# artifact itself (deb/rpm updates run the same electron-updater download path but hand off to the
# system package manager, which needs polkit interaction CI cannot provide; their install
# correctness is covered by verify-install-linux.sh).
#
# Serves the candidate AppImage back to itself from a loopback feed claiming version 9.9.9. With
# FILEN_E2E_UPDATER=1 the app consumes the loopback feed and confirms the install without a user
# click (src/lib/updater.ts). Success means the full pipeline ran: check -> download -> sha512
# verify -> in-place file swap -> relaunch. APPIMAGE_EXTRACT_AND_RUN avoids the FUSE dependency;
# the runtime still sets $APPIMAGE, which the updater needs for the swap.
#
# Usage: verify-update-linux.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"

if [ "$ARCH" = "x64" ]; then
	APPIMAGE="Filen_linux_x86_64.AppImage"
	YML="latest-linux.yml"
else
	APPIMAGE="Filen_linux_arm64.AppImage"
	YML="latest-linux-arm64.yml"
fi

FEED_PORT=8125
APP_DIR="$HOME/filen-e2e"
LOG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/@filen/logs/desktop.log"
SERVER_PID=""
XVFB_PID=""

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
	[ -n "$XVFB_PID" ] && kill "$XVFB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. Install the candidate AppImage where the updater can swap it.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp "prod/$APPIMAGE" "$APP_DIR/$APPIMAGE"
chmod +x "$APP_DIR/$APPIMAGE"

# 2. Loopback feed claiming 9.9.9.
FEED_DIR="$(mktemp -d /tmp/filen-feed.XXXXXX)"
cp "prod/$APPIMAGE" "$FEED_DIR/$APPIMAGE"
SHA512="$(openssl dgst -sha512 -binary "$FEED_DIR/$APPIMAGE" | base64 -w0)"
SIZE="$(stat -c %s "$FEED_DIR/$APPIMAGE")"
cat > "$FEED_DIR/$YML" <<EOF
version: 9.9.9
files:
  - url: $APPIMAGE
    sha512: ${SHA512}
    size: ${SIZE}
path: $APPIMAGE
sha512: ${SHA512}
releaseDate: '2026-01-01T00:00:00.000Z'
EOF

python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$FEED_DIR" >/dev/null 2>&1 &
SERVER_PID=$!

# 3. Headless display for the Electron GUI. Xvfb outlives the first process, so the relaunched
#    app keeps a valid DISPLAY (xvfb-run would tear it down when the original process exits).
sudo apt-get install -y -q xvfb >/dev/null
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 1

# Ubuntu 23.10+ restricts unprivileged user namespaces, which breaks Chromium's sandbox for
# non-setuid binaries like AppImages. The relaunch after the update runs WITHOUT --no-sandbox
# (electron-updater spawns the bare AppImage), so allow userns for the relaunched instance.
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null 2>&1 || true

# 4. Launch in E2E updater mode.
rm -f "$LOG_FILE"
INODE_BEFORE="$(stat -c %i "$APP_DIR/$APPIMAGE")"
FILEN_E2E_UPDATER=1 FILEN_E2E_UPDATE_FEED="http://127.0.0.1:${FEED_PORT}/" APPIMAGE_EXTRACT_AND_RUN=1 \
	"$APP_DIR/$APPIMAGE" --no-sandbox >/dev/null 2>&1 &
ORIGINAL_PID=$!

# 5. Wait for: download -> in-place swap (inode changes) -> relaunch.
DEADLINE=$((SECONDS + 600))
SWAPPED=""
RELAUNCHED=""
while [ $SECONDS -lt $DEADLINE ]; do
	sleep 5

	if [ -z "$SWAPPED" ] && [ -e "$APP_DIR/$APPIMAGE" ]; then
		INODE_NOW="$(stat -c %i "$APP_DIR/$APPIMAGE" 2>/dev/null || echo "$INODE_BEFORE")"
		if [ "$INODE_NOW" != "$INODE_BEFORE" ]; then
			SWAPPED=1
			echo "AppImage was swapped in place (inode $INODE_BEFORE -> $INODE_NOW)"
		fi
	fi

	if [ -n "$SWAPPED" ]; then
		NEW_PID="$(pgrep -f "$APP_DIR/$APPIMAGE" | head -1 || true)"
		if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$ORIGINAL_PID" ]; then
			RELAUNCHED=1
			echo "App relaunched after update (pid $NEW_PID)"
			break
		fi
	fi
done

[ -n "$SWAPPED" ] || fail "the AppImage was never swapped within the timeout"
[ -n "$RELAUNCHED" ] || fail "app did not relaunch after the swap"

grep -q "Update downloaded" "$LOG_FILE" || fail "desktop.log has no 'Update downloaded' entry"
grep -q "Installing update" "$LOG_FILE" || fail "desktop.log has no 'Installing update' entry"

echo "verify-update-linux PASSED for $ARCH"
