"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastExistsCheck = void 0;
class FastExistsCheck {
    constructor({ fileSystem }) {
        this.fileSystem = fileSystem;
    }
    async execute(path) {
        if (this.fileSystem.virtualFiles[path.toString()]) {
            return true;
        }
        try {
            await this.fileSystem.sdk.fs().stat({ path: path.toString() });
            return true;
        }
        catch (e) {
            return false;
        }
    }
    run(path, callback) {
        this.execute(path)
            .then(result => {
            callback(result);
        })
            .catch(err => {
            callback(err);
        });
    }
}
exports.FastExistsCheck = FastExistsCheck;
exports.default = FastExistsCheck;
//# sourceMappingURL=fastExistsCheck.js.map