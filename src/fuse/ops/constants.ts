export const DIRECTORY_MODE = 0o40000
export const FILE_MODE = 0o100000
export const FUSE_DEFAULT_DIRECTORY_MODE = 0o777
export const FUSE_DEFAULT_FILE_MODE = 0o777
export const FUSE_DEFAULT_PERMISSIONS = 0o777

export const pathsToIgnore: RegExp[] = [
	/^\/BDMV$/,
	/^\/autorun\.inf$/,
	/^\/.Trash$/,
	/^\/.Trash-1001\/files$/,
	/\/.xdg-volume-info$/,
	/\/.hidden$/
]
