"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ops = void 0;
const noop_1 = __importDefault(require("./noop"));
const access_1 = __importDefault(require("./access"));
const statfs_1 = __importDefault(require("./statfs"));
const getattr_1 = __importDefault(require("./getattr"));
const readdir_1 = __importDefault(require("./readdir"));
const readlink_1 = __importDefault(require("./readlink"));
const getxattr_1 = __importDefault(require("./getxattr"));
const setxattr_1 = __importDefault(require("./setxattr"));
const listxattr_1 = __importDefault(require("./listxattr"));
const removexattr_1 = __importDefault(require("./removexattr"));
const opendir_1 = __importDefault(require("./opendir"));
const unlink_1 = __importDefault(require("./unlink"));
const mkdir_1 = __importDefault(require("./mkdir"));
const rename_1 = __importDefault(require("./rename"));
const create_1 = __importDefault(require("./create"));
const open_1 = __importDefault(require("./open"));
const release_1 = __importDefault(require("./release"));
const read_1 = __importDefault(require("./read"));
const write_1 = __importDefault(require("./write"));
class Ops {
    constructor({ sdk, baseTmpPath, fullDownloadsTmpPath, writeTmpPath, decryptedChunksTmpPath, xattrPath, encryptedChunksTmpPath, uploadsTmpPath }) {
        this.uploads = {};
        this.readWriteMutex = {};
        this.openMode = {};
        this.virtualFiles = {};
        this.openFileHandles = {};
        this.writeTmpChunkToDiskMutex = {};
        this.downloadChunkToLocalActive = {};
        this.chunkDownloadsActive = {};
        this.nextFd = 0;
        this.sdk = sdk;
        this.baseTmpPath = baseTmpPath;
        this.fullDownloadsTmpPath = fullDownloadsTmpPath;
        this.writeTmpPath = writeTmpPath;
        this.decryptedChunksTmpPath = decryptedChunksTmpPath;
        this.xattrPath = xattrPath;
        this.encryptedChunksTmpPath = encryptedChunksTmpPath;
        this.uploadsTmpPath = uploadsTmpPath;
        this._noop = new noop_1.default();
        this._access = new access_1.default({ ops: this });
        this._statFS = new statfs_1.default({ ops: this });
        this._getattr = new getattr_1.default({ ops: this });
        this._readdir = new readdir_1.default({ ops: this });
        this._readlink = new readlink_1.default();
        this._getxattr = new getxattr_1.default({ ops: this });
        this._listxattr = new listxattr_1.default({ ops: this });
        this._setxattr = new setxattr_1.default({ ops: this });
        this._removexattr = new removexattr_1.default({ ops: this });
        this._opendir = new opendir_1.default({ ops: this });
        this._unlink = new unlink_1.default({ ops: this });
        this._mkdir = new mkdir_1.default({ ops: this });
        this._rename = new rename_1.default({ ops: this });
        this._create = new create_1.default({ ops: this });
        this._open = new open_1.default({ ops: this });
        this._release = new release_1.default({ ops: this });
        this._read = new read_1.default({ ops: this });
        this._write = new write_1.default({ ops: this });
    }
    init(callback) {
        this._noop.run(callback);
    }
    access(path, mode, callback) {
        this._access.run(path, mode, callback);
    }
    statfs(path, callback) {
        this._statFS.run(path, callback);
    }
    getattr(path, callback) {
        this._getattr.run(path, callback);
    }
    fgetattr(path, _fd, callback) {
        this._getattr.run(path, callback);
    }
    flush(_path, _fd, callback) {
        this._noop.run(callback);
    }
    fsync(_path, _dataSync, _fd, callback) {
        this._noop.run(callback);
    }
    fsyncdir(_path, _dataSync, _fd, callback) {
        this._noop.run(callback);
    }
    readdir(path, callback) {
        this._readdir.run(path, callback);
    }
    truncate(_path, _size, callback) {
        this._noop.run(callback);
    }
    ftruncate(_path, _fd, _size, callback) {
        this._noop.run(callback);
    }
    readlink(path, callback) {
        this._readlink.run(path, callback);
    }
    chown(_path, _uid, _gid, callback) {
        this._noop.run(callback);
    }
    chmod(_path, _mode, callback) {
        this._noop.run(callback);
    }
    mknod(_path, _mode, _dev, callback) {
        this._noop.run(callback);
    }
    setxattr(path, name, value, _size, _flags, callback) {
        this._setxattr.run(path, name, value, callback);
    }
    getxattr(path, name, _size, callback) {
        this._getxattr.run(path, name, callback);
    }
    listxattr(path, callback) {
        this._listxattr.run(path, callback);
    }
    removexattr(path, name, callback) {
        this._removexattr.run(path, name, callback);
    }
    open(path, mode, callback) {
        this._open.run(path, mode, callback);
    }
    opendir(path, mode, callback) {
        this._opendir.run(path, mode, callback);
    }
    read(path, _fd, buffer, length, position, callback) {
        this._read.run(path, buffer, length, position, callback);
    }
    write(path, _fd, buffer, length, position, callback) {
        console.log("write", path);
        this._write.run(path, buffer, length, position, callback);
    }
    release(path, _fd, callback) {
        console.log("release", path);
        this._release.run(path, callback);
    }
    releasedir(_path, _fd, callback) {
        this._noop.run(callback);
    }
    create(path, mode, callback) {
        this._create.run(path, mode, callback);
    }
    utimens(_path, _atime, _mtime, callback) {
        this._noop.run(callback);
    }
    unlink(path, callback) {
        this._unlink.run(path, callback);
    }
    rename(src, dest, callback) {
        this._rename.run(src, dest, callback);
    }
    link(_src, _dest, callback) {
        this._noop.run(callback);
    }
    symlink(_src, _dest, callback) {
        this._noop.run(callback);
    }
    mkdir(path, _mode, callback) {
        this._mkdir.run(path, callback);
    }
    rmdir(path, callback) {
        this._unlink.run(path, callback);
    }
}
exports.Ops = Ops;
exports.default = Ops;
//# sourceMappingURL=index.js.map