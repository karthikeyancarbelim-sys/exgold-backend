"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequired = void 0;
const validateRequired = (fields) => {
    return (req, res, next) => {
        for (const field of fields) {
            if (!req.body[field]) {
                return res.status(400).json({
                    error: `${field} is required`,
                });
            }
        }
        next();
    };
};
exports.validateRequired = validateRequired;
