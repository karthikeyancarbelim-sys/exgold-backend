"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAdmin = void 0;
const verifyAdmin = async (req, res, next) => {
    try {
        const role = req.user?.role;
        // ✅ allow both admin & superadmin
        if (!role || (role !== "admin" && role !== "superadmin")) {
            return res.status(403).json({ message: "Admin access required" });
        }
        next();
    }
    catch {
        res.status(500).json({ message: "Admin check failed" });
    }
};
exports.verifyAdmin = verifyAdmin;
