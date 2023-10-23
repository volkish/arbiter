"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = new class {
    constructor() {
        this.tokens = new Map();
    }
    set(token) {
        this.tokens.set(token.id, token);
    }
    delete(token) {
        this.tokens.delete(token.id);
    }
    get(id) {
        return this.tokens.get(id);
    }
};
