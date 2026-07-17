#!/usr/bin/env bash
# Auto-update end-to-end check for the AppImage - the Linux format whose auto-update replaces the
# artifact itself. The deb/rpm update flows are NOT E2E-tested here yet: they are feasible in CI
# (electron-updater skips pkexec when running as root, so a root container can drive the full
# DebUpdater/RpmUpdater pipeline) but deliberately deferred; their download/selection path is
# shared with this check and their install correctness is covered by verify-install-linux.sh.
#
# Serves the REAL latest-linux yml back to the candidate with only the version rewritten to 9.9.9,
# so file selection runs against the production manifest shape. With FILEN_E2E_UPDATER=1 the app
# consumes the loopback feed and confirms the install without a user click (one-shot via
# FILEN_E2E_ONCE_FILE - the relaunched instance inherits the env, re-logs its E2E lines, and skips
# reinstalling; those re-logged lines are the relaunch-liveness evidence). Success means: check ->
# file selection -> download -> sha512 verify -> in-place swap -> relaunch of a process that stays
# alive. APPIMAGE_EXTRACT_AND_RUN avoids the FUSE dependency; the runtime still sets $APPIMAGE,
# which the updater needs for the swap.
#
# Usage: verify-update-linux.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"

if [ "$ARCH" = "x64" ]; then
	APPIMAGE="Filen_linux_x86_64.AppImage"
	DEB="Filen_linux_amd64.deb"
	RPM="Filen_linux_x86_64.rpm"
	YML="latest-linux.yml"
else
	APPIMAGE="Filen_linux_arm64.AppImage"
	DEB="Filen_linux_arm64.deb"
	RPM="Filen_linux_aarch64.rpm"
	YML="latest-linux-arm64.yml"
fi

FEED_PORT=8125
APP_DIR="$HOME/filen-e2e"
LOG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/@filen/logs/desktop.log"
ONCE_FILE="$(mktemp -u /tmp/filen-e2e-once.XXXXXX)"
SERVER_PID=""
XVFB_PID=""

fail() {
	echo "FAIL: $1"
	if [ -f "$LOG_FILE" ]; then
		echo "--- desktop.log updater lines ---"
		grep -iE "updater|update|installing" "$LOG_FILE" | tail -n 60 || true
	fi
	exit 1
}

cleanup() {
	pkill -f "$APP_DIR" >/dev/null 2>&1 || true
	[ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1 || true
	[ -n "$XVFB_PID" ] && kill "$XVFB_PID" >/dev/null 2>&1 || true
	rm -f "$ONCE_FILE"
}
trap cleanup EXIT

# 1. Install the candidate AppImage where the updater can swap it.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp "prod/$APPIMAGE" "$APP_DIR/$APPIMAGE"
chmod +x "$APP_DIR/$APPIMAGE"

# 2. Loopback feed: the REAL manifest (AppImage + deb + rpm entries), version rewritten to 9.9.9.
FEED_DIR="$(mktemp -d /tmp/filen-feed.XXXXXX)"
sed -E 's/^version:.*$/version: 9.9.9/' "prod/$YML" > "$FEED_DIR/$YML"
cp "prod/$APPIMAGE" "prod/$DEB" "prod/$RPM" "$FEED_DIR/"

python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$FEED_DIR" >/dev/null 2>&1 &
SERVER_PID=$!

READY=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	if curl -sf --max-time 3 "http://127.0.0.1:${FEED_PORT}/$YML" >/dev/null 2>&1; then
		READY=1
		break
	fi
	sleep 1
done
[ -n "$READY" ] || fail "loopback feed server did not become ready on port $FEED_PORT"

# 3. Headless display for the Electron GUI. Xvfb outlives the first process so the relaunched app
#    keeps a valid DISPLAY (xvfb-run would tear it down when the original process exits).
sudo apt-get update -qq >/dev/null 2>&1 || true
sudo apt-get install -y -q xvfb >/dev/null
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
XREADY=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	[ -S /tmp/.X11-unix/X99 ] && {
		XREADY=1
		break
	}
	sleep 1
done
[ -n "$XREADY" ] || fail "Xvfb did not come up"

# Ubuntu 23.10+ restricts unprivileged user namespaces, which breaks Chromium's sandbox for
# non-setuid binaries like AppImages. The relaunch after the update runs WITHOUT --no-sandbox
# (electron-updater spawns the bare AppImage), so this knob is load-bearing for relaunch survival -
# assert it took effect instead of silently proceeding.
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null 2>&1 || true
if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
	[ "$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)" = "0" ] || fail "could not lift the userns restriction the post-update relaunch depends on"
fi

# 4. Launch in E2E updater mode.
rm -f "$LOG_FILE"
INODE_BEFORE="$(stat -c %i "$APP_DIR/$APPIMAGE")"
FILEN_E2E_UPDATER=1 FILEN_E2E_UPDATE_FEED="http://127.0.0.1:${FEED_PORT}/" FILEN_E2E_ONCE_FILE="$ONCE_FILE" APPIMAGE_EXTRACT_AND_RUN=1 \
	"$APP_DIR/$APPIMAGE" --no-sandbox >/dev/null 2>&1 &
ORIGINAL_PID=$!

ENGAGED=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
	sleep 5
	if [ -f "$LOG_FILE" ] && grep -q "Updater E2E mode enabled" "$LOG_FILE"; then
		ENGAGED=1
		break
	fi
done
[ -n "$ENGAGED" ] || fail "E2E feed override did not engage within 60s"

# 5. Wait for: download -> in-place swap (inode changes) -> relaunch.
DEADLINE=$((SECONDS + 600))
SWAPPED=""
RELAUNCHED=""
NEW_PID=""
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
		NEW_PID="$(pgrep -f "$APP_DIR/$APPIMAGE" | grep -v "^$ORIGINAL_PID$" | head -1 || true)"
		if [ -n "$NEW_PID" ]; then
			RELAUNCHED=1
			echo "App relaunched after update (pid $NEW_PID)"
			break
		fi
	fi
done

[ -n "$SWAPPED" ] || fail "the AppImage was never swapped within the timeout"
[ -n "$RELAUNCHED" ] || fail "app did not relaunch after the swap"

# 6. Swap integrity: the file at the install path must be byte-identical to the served artifact
#    and still executable (electron-updater verified the download's sha512; this catches a broken
#    handoff between its cache and the install path).
cmp -s "prod/$APPIMAGE" "$APP_DIR/$APPIMAGE" || fail "swapped AppImage differs from the served artifact"
[ -x "$APP_DIR/$APPIMAGE" ] || fail "swapped AppImage lost its executable bit"

# 7. Relaunch liveness: the successor must survive its startup, and - because it inherits the E2E
#    env and re-logs its E2E banner while the once-marker suppresses a second install - the banner
#    count proves the app-level code ran again, not just the AppImage runtime shell.
sleep 15
kill -0 "$NEW_PID" 2>/dev/null || fail "relaunched app (pid $NEW_PID) died shortly after starting"
[ "$(grep -c "Updater E2E mode enabled" "$LOG_FILE")" -ge 2 ] || fail "relaunched instance never reached app code (single E2E banner in log)"

grep -q "Update downloaded" "$LOG_FILE" || fail "desktop.log has no 'Update downloaded' entry"
grep -q "Installing update" "$LOG_FILE" || fail "desktop.log has no 'Installing update' entry"
grep -q "$APPIMAGE" "$LOG_FILE" || fail "desktop.log never mentions $APPIMAGE - the updater selected a different file than real clients would"

echo "verify-update-linux PASSED for $ARCH"
