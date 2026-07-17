#!/usr/bin/env bash
# Install-check for the Linux artifacts on a runner of the target arch.
#
#   - deb: real dpkg install on the runner; package must land as /opt/Filen with the right arch,
#     resources/package-type must say "deb" (electron-updater picks its updater class from it)
#   - rpm: real dnf install inside a Fedora container (GitHub has no RPM-based runners)
#   - AppImage: --appimage-extract (no FUSE needed); resources/package-type must NOT exist -
#     a leak would silently switch every AppImage client to the RpmUpdater on the next release
#   - zip: extracts and contains the executable
#   - latest-linux*.yml sizes/hashes match the artifacts
#
# Usage: verify-install-linux.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"

if [ "$ARCH" = "x64" ]; then
	DEB="Filen_linux_amd64.deb"
	RPM="Filen_linux_x86_64.rpm"
	APPIMAGE="Filen_linux_x86_64.AppImage"
	ZIP="Filen_linux_x64.zip"
	YML="latest-linux.yml"
	FILE_ARCH="x86-64"
else
	DEB="Filen_linux_arm64.deb"
	RPM="Filen_linux_aarch64.rpm"
	APPIMAGE="Filen_linux_arm64.AppImage"
	ZIP="Filen_linux_arm64.zip"
	YML="latest-linux-arm64.yml"
	FILE_ARCH="aarch64"
fi

fail() {
	echo "FAIL: $1"
	exit 1
}

# 1. Feed manifest sanity - deployed clients trust it blindly.
python3 build/ci/check-feed.py "prod/$YML" prod

# 2. deb - native install on this runner.
sudo dpkg -i "prod/$DEB" || sudo apt-get install -f -y
[ -x /opt/Filen/Filen ] || fail "deb: /opt/Filen/Filen missing or not executable after install"
file /opt/Filen/Filen | grep -q "$FILE_ARCH" || fail "deb: Filen binary is not $FILE_ARCH: $(file /opt/Filen/Filen)"
[ "$(cat /opt/Filen/resources/package-type)" = "deb" ] || fail "deb: resources/package-type is not 'deb' - electron-updater would pick the wrong updater"
[ -f /opt/Filen/resources/app-update.yml ] || fail "deb: resources/app-update.yml missing - installed app could never auto-update"
dpkg -s filen | grep -q "Status: install ok installed" || fail "deb: dpkg does not report the package as installed"
echo "OK: deb installed, $FILE_ARCH, package-type=deb"

# 3. rpm - real dnf install inside a Fedora container (native arch image on this runner).
docker run --rm -v "$PWD/prod:/prod:ro" fedora:latest bash -ec "
	dnf install -y -q /prod/$RPM
	test -x /opt/Filen/Filen
	grep -qx rpm /opt/Filen/resources/package-type
	test -f /opt/Filen/resources/app-update.yml
	rpm -q Filen
" || fail "rpm: install/verification inside the Fedora container failed"
echo "OK: rpm installed in Fedora container, package-type=rpm"

# 4. AppImage - extract (runs the runtime's extractor, no FUSE required) and inspect.
WORK="$(mktemp -d /tmp/filen-appimage.XXXXXX)"
cp "prod/$APPIMAGE" "$WORK/"
chmod +x "$WORK/$APPIMAGE"
(cd "$WORK" && "./$APPIMAGE" --appimage-extract >/dev/null)
[ -x "$WORK/squashfs-root/Filen" ] || fail "AppImage: Filen executable missing from payload"
file "$WORK/squashfs-root/Filen" | grep -q "$FILE_ARCH" || fail "AppImage: Filen binary is not $FILE_ARCH"
[ -f "$WORK/squashfs-root/resources/app-update.yml" ] || fail "AppImage: resources/app-update.yml missing - could never auto-update"
[ ! -e "$WORK/squashfs-root/resources/package-type" ] || fail "AppImage: contains resources/package-type - AppImage clients would be misrouted to the deb/rpm updater on the next release"
rm -rf "$WORK"
echo "OK: AppImage payload complete, $FILE_ARCH, no package-type leak"

# 5. zip - manual-install artifact.
WORK="$(mktemp -d /tmp/filen-zip.XXXXXX)"
unzip -q "prod/$ZIP" -d "$WORK"
[ -x "$WORK/Filen" ] || fail "zip: Filen executable missing"
file "$WORK/Filen" | grep -q "$FILE_ARCH" || fail "zip: Filen binary is not $FILE_ARCH"
rm -rf "$WORK"
echo "OK: zip payload complete, $FILE_ARCH"

echo "verify-install-linux PASSED for $ARCH"
