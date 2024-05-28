"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSystem = void 0;
const WebDAV = __importStar(require("@filen/webdav-server"));
const serializer_1 = __importDefault(require("./serializer"));
const propertyManager_1 = __importDefault(require("./ops/propertyManager"));
const lockManager_1 = __importDefault(require("./ops/lockManager"));
const type_1 = __importDefault(require("./ops/type"));
const readDir_1 = __importDefault(require("./ops/readDir"));
const displayName_1 = __importDefault(require("./ops/displayName"));
const creationDate_1 = __importDefault(require("./ops/creationDate"));
const lastModifiedDate_1 = __importDefault(require("./ops/lastModifiedDate"));
const size_1 = __importDefault(require("./ops/size"));
const mimeType_1 = __importDefault(require("./ops/mimeType"));
const etag_1 = __importDefault(require("./ops/etag"));
const fastExistsCheck_1 = __importDefault(require("./ops/fastExistsCheck"));
const copy_1 = __importDefault(require("./ops/copy"));
const move_1 = __importDefault(require("./ops/move"));
const rename_1 = __importDefault(require("./ops/rename"));
const delete_1 = __importDefault(require("./ops/delete"));
const create_1 = __importDefault(require("./ops/create"));
const openWriteStream_1 = __importDefault(require("./ops/openWriteStream"));
const openReadStream_1 = __importDefault(require("./ops/openReadStream"));
class FileSystem extends WebDAV.FileSystem {
    constructor({ sdk }) {
        super(new serializer_1.default({ sdk }));
        this.propertyManagers = {};
        this.lockManagers = {};
        this.virtualFiles = {};
        this.sdk = sdk;
        this.__propertyManager = new propertyManager_1.default({ fileSystem: this });
        this.__lockManager = new lockManager_1.default({ fileSystem: this });
        this.__type = new type_1.default({ fileSystem: this });
        this.__readDir = new readDir_1.default({ fileSystem: this });
        this.__displayName = new displayName_1.default({ fileSystem: this });
        this.__creationDate = new creationDate_1.default({ fileSystem: this });
        this.__lastModifiedDate = new lastModifiedDate_1.default({ fileSystem: this });
        this.__size = new size_1.default({ fileSystem: this });
        this.__mimeType = new mimeType_1.default({ fileSystem: this });
        this.__etag = new etag_1.default({ fileSystem: this });
        this.__fastExistsCheck = new fastExistsCheck_1.default({ fileSystem: this });
        this.__copy = new copy_1.default({ fileSystem: this });
        this.__move = new move_1.default({ fileSystem: this });
        this.__rename = new rename_1.default({ fileSystem: this });
        this.__delete = new delete_1.default({ fileSystem: this });
        this.__create = new create_1.default({ fileSystem: this });
        this.__openWriteStream = new openWriteStream_1.default({ fileSystem: this });
        this.__openReadStream = new openReadStream_1.default({ fileSystem: this });
    }
    _propertyManager(path, _ctx, callback) {
        this.__propertyManager.run(path, callback);
    }
    _lockManager(path, _ctx, callback) {
        this.__lockManager.run(path, callback);
    }
    _type(path, _ctx, callback) {
        this.__type.run(path, callback);
    }
    _readDir(path, _ctx, callback) {
        this.__readDir.run(path, callback);
    }
    _displayName(path, _ctx, callback) {
        this.__displayName.run(path, callback);
    }
    _creationDate(path, _ctx, callback) {
        this.__creationDate.run(path, callback);
    }
    _lastModifiedDate(path, _ctx, callback) {
        this.__lastModifiedDate.run(path, callback);
    }
    _size(path, _ctx, callback) {
        this.__size.run(path, callback);
    }
    _mimeType(path, _ctx, callback) {
        this.__mimeType.run(path, callback);
    }
    _etag(path, _ctx, callback) {
        this.__etag.run(path, callback);
    }
    _fastExistCheck(_ctx, path, callback) {
        this.__fastExistsCheck.run(path, callback);
    }
    _copy(pathFrom, pathTo, _ctx, callback) {
        this.__copy.run(pathFrom, pathTo, callback);
    }
    _move(pathFrom, pathTo, _ctx, callback) {
        this.__move.run(pathFrom, pathTo, callback);
    }
    _rename(pathFrom, newName, _ctx, callback) {
        this.__rename.run(pathFrom, newName, callback);
    }
    _delete(path, _ctx, callback) {
        this.__delete.run(path, callback);
    }
    _create(path, ctx, callback) {
        console.log(ctx.type);
        this.__create.run(path, ctx, callback);
    }
    _openWriteStream(path, _ctx, callback) {
        console.log(_ctx.mode);
        this.__openWriteStream.run(path, callback);
    }
    _openReadStream(path, _ctx, callback) {
        this.__openReadStream.run(path, callback);
    }
}
exports.FileSystem = FileSystem;
exports.default = FileSystem;
//# sourceMappingURL=index.js.map