"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathsToIgnore = exports.FUSE_DEFAULT_PERMISSIONS = exports.FUSE_DEFAULT_FILE_MODE = exports.FUSE_DEFAULT_DIRECTORY_MODE = exports.FILE_MODE = exports.DIRECTORY_MODE = void 0;
exports.DIRECTORY_MODE = 0o40000;
exports.FILE_MODE = 0o100000;
exports.FUSE_DEFAULT_DIRECTORY_MODE = 0o777;
exports.FUSE_DEFAULT_FILE_MODE = 0o777;
exports.FUSE_DEFAULT_PERMISSIONS = 0o777;
exports.pathsToIgnore = [
    /^\/BDMV$/,
    /^\/autorun\.inf$/,
    /^\/.Trash$/,
    /^\/.Trash-1001\/files$/,
    /\/.xdg-volume-info$/,
    /\/.hidden$/
];
//# sourceMappingURL=constants.js.map