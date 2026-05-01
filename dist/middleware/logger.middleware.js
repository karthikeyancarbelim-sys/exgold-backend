"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const logger = (req, _res, next) => {
    console.log(`${new Date().toISOString()} | ${req.method} | ${req.originalUrl}`);
    next();
};
exports.logger = logger;
