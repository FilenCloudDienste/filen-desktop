#!/usr/bin/env bash
# Install-check for the Linux artifacts on a runner of the target arch.
#
#   - deb: real dpkg install; /opt/Filen payload + arch, resources/package-type == "deb"
#     (electron-updater picks its updater class from it), postinst outcomes that soft-fail by
#     design (AppArmor userns profile, /usr/bin symlink, desktop entry)
#   - rpm: real dnf install inside a pinned Fedora container + ldd sanity (GitHub has no
#     RPM-based runners; the minimal rootfs also genuinely exercises the rpm's Requires)
#   - AppImage: --appimage-extract; package-type must NOT leak in (would misroute AppImage
#     clients to the rpm/deb updater next release); rclone helper must be the right arch
#   - zip: payload + the same package-type absence (a leaked "deb" would make portable-zip
#     installs run an active DebUpdater that pkexec-installs debs over the user's system)
#   - latest-linux*.yml: hashes/sizes, exact file set, version, no cross-arch contamination
#
# Usage: verify-install-linux.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"
EXPECTED_VERSION="$(node -p "require('./package.json').version")"

if [ "$ARCH" = "x64" ]; then
	DEB="Filen_linux_amd64.deb"
	RPM="Filen_linux_x86_64.rpm"
	APPIMAGE="Filen_linux_x86_64.AppImage"
	ZIP="Filen_linux_x64.zip"
	YML="latest-linux.yml"
	FILE_ARCH="x86-64"
	RCLONE="rclone-linux-amd64"
	FORBID=(--forbid arm64 --forbid aarch64)
else
	DEB="Filen_linux_arm64.deb"
	RPM="Filen_linux_aarch64.rpm"
	APPIMAGE="Filen_linux_arm64.AppImage"
	ZIP="Filen_linux_arm64.zip"
	YML="latest-linux-arm64.yml"
	FILE_ARCH="aarch64"
	RCLONE="rclone-linux-arm64"
	FORBID=(--forbid x86_64 --forbid amd64)
fi

fail() {
	echo "FAIL: $1"
	exit 1
}

assert_app_update_yml() {
	local file="$1" source="$2"

	[ -f "$file" ] || fail "$source: app-update.yml missing - installed app could never auto-update"
	grep -q "^url: https://cdn.filen.io/@filen/desktop/release/latest/" "$file" || fail "$source: app-update.yml does not point at the production CDN feed"
	grep -q "^channel:" "$file" && fail "$source: app-update.yml carries an unexpected channel key (would change the requested manifest filename)"

	return 0
}

# 1. Feed manifest: hashes, exact set (a builder regression dropping the deb/rpm entry would strand
#    that whole cohort with updater errors while everything else stays green), version, no
#    cross-arch entries (both arches' files sit in the same prod/, so a wrong entry would hash-match).
python3 build/ci/check-feed.py "prod/$YML" prod \
	--expect "$APPIMAGE" --expect "$DEB" --expect "$RPM" \
	--expect-version "$EXPECTED_VERSION" \
	"${FORBID[@]}"

# 2. deb - native install on this runner.
sudo dpkg -i "prod/$DEB" || sudo apt-get install -f -y
[ -x /opt/Filen/Filen ] || fail "deb: /opt/Filen/Filen missing or not executable after install"
file /opt/Filen/Filen | grep -q "$FILE_ARCH" || fail "deb: Filen binary is not $FILE_ARCH: $(file /opt/Filen/Filen)"
[ "$(cat /opt/Filen/resources/package-type)" = "deb" ] || fail "deb: resources/package-type is not 'deb' - electron-updater would pick the wrong updater"
assert_app_update_yml /opt/Filen/resources/app-update.yml "deb"
dpkg -s filen | grep -q "Status: install ok installed" || fail "deb: dpkg does not report the package as installed"
# postinst soft-fails by design; assert its outcomes here (Ubuntu 24.04 runner: the AppArmor
# profile MUST install - without it the sandbox aborts on stock 24.04 desktops).
[ -f /etc/apparmor.d/Filen ] || fail "deb: /etc/apparmor.d/Filen missing - postinst AppArmor install silently failed (app aborts at sandbox init on stock Ubuntu 24.04)"
[ -e /usr/bin/Filen ] || fail "deb: /usr/bin/Filen missing - postinst symlink/alternatives silently failed"
[ -f /usr/share/applications/Filen.desktop ] || fail "deb: desktop entry missing"
echo "OK: deb installed, $FILE_ARCH, package-type=deb, apparmor profile + /usr/bin link + desktop entry present"

# 3. rpm - real dnf install inside a pinned Fedora container (native arch image on this runner;
#    the minimal rootfs genuinely exercises the rpm's dependency list, unlike the desktop runner).
docker run --rm -v "$PWD/prod:/prod:ro" registry.fedoraproject.org/fedora:42 bash -ec "
	dnf install -y -q /prod/$RPM
	test -x /opt/Filen/Filen
	grep -qx rpm /opt/Filen/resources/package-type
	test -f /opt/Filen/resources/app-update.yml
	rpm -q Filen
	if ldd /opt/Filen/Filen | grep -q 'not found'; then echo 'unresolved libraries:'; ldd /opt/Filen/Filen | grep 'not found'; exit 1; fi
" || fail "rpm: install/verification inside the Fedora container failed"
echo "OK: rpm installed in Fedora container, package-type=rpm, all libraries resolve"

# 4. AppImage - extract (no FUSE required) and inspect.
WORK="$(mktemp -d /tmp/filen-appimage.XXXXXX)"
cp "prod/$APPIMAGE" "$WORK/"
chmod +x "$WORK/$APPIMAGE"
(cd "$WORK" && "./$APPIMAGE" --appimage-extract >/dev/null)
[ -x "$WORK/squashfs-root/Filen" ] || fail "AppImage: Filen executable missing from payload"
file "$WORK/squashfs-root/Filen" | grep -q "$FILE_ARCH" || fail "AppImage: Filen binary is not $FILE_ARCH"
assert_app_update_yml "$WORK/squashfs-root/resources/app-update.yml" "AppImage"
[ ! -e "$WORK/squashfs-root/resources/package-type" ] || fail "AppImage: contains resources/package-type - AppImage clients would be misrouted to the deb/rpm updater on the next release"
file "$WORK/squashfs-root/resources/app.asar.unpacked/bin/rclone/$RCLONE" | grep -q "$FILE_ARCH" || fail "AppImage: bundled $RCLONE is not $FILE_ARCH - network drive would be dead for all $ARCH users"
rm -rf "$WORK"
echo "OK: AppImage payload complete, $FILE_ARCH, no package-type leak, rclone arch correct"

# 5. zip - manual-install artifact.
WORK="$(mktemp -d /tmp/filen-zip.XXXXXX)"
unzip -q "prod/$ZIP" -d "$WORK"
[ -x "$WORK/Filen" ] || fail "zip: Filen executable missing"
file "$WORK/Filen" | grep -q "$FILE_ARCH" || fail "zip: Filen binary is not $FILE_ARCH"
[ ! -e "$WORK/resources/package-type" ] || fail "zip: contains resources/package-type - portable-zip installs would run an active deb/rpm updater against the user's system"
rm -rf "$WORK"
echo "OK: zip payload complete, $FILE_ARCH, no package-type leak"

echo "verify-install-linux PASSED for $ARCH"
