"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationRead = exports.getMyNotifications = void 0;
const getMyNotifications = async (_req, res) => {
    return res.json([]);
};
exports.getMyNotifications = getMyNotifications;
const markNotificationRead = async (_req, res) => {
    return res.json({ success: true });
};
exports.markNotificationRead = markNotificationRead;
