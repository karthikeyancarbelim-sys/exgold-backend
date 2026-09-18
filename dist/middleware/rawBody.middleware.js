"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rawBodyMiddleware = void 0;
const rawBodyMiddleware = (req, _res, next) => {
    let data = "";
    req.on("data", (chunk) => {
        data += chunk;
    });
    req.on("end", () => {
        req.rawBody = data;
        next();
    });
};
exports.rawBodyMiddleware = rawBodyMiddleware;
