"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
function generateRandomString() {
    return String(Math.floor(Math.random() * 100000000000000));
}
class Token extends events_1.EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.id = generateRandomString();
    }
    destroy() {
        if (!this.destroyed) {
            this.destroyed = true;
            this.emit('destroy');
        }
    }
}
exports.default = Token;
