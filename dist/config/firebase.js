"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const serviceAccountFromEnvironment = () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
};
const serviceAccountFromFile = () => {
    const candidates = [
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        path_1.default.join(__dirname, "firebase.json"),
        path_1.default.join(process.cwd(), "dist", "config", "firebase.json"),
        path_1.default.join(process.cwd(), "src", "config", "firebase.json"),
    ].filter((candidate) => Boolean(candidate));
    const credentialPath = candidates.find((candidate) => fs_1.default.existsSync(candidate));
    if (!credentialPath)
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(credentialPath, "utf8"));
    }
    catch {
        throw new Error("Firebase service account file is not valid JSON");
    }
};
if (!firebase_admin_1.default.apps.length) {
    const serviceAccount = serviceAccountFromEnvironment() || serviceAccountFromFile();
    const projectId = serviceAccount?.projectId ||
        serviceAccount?.project_id ||
        process.env.FIREBASE_PROJECT_ID ||
        "ex-gold";
    firebase_admin_1.default.initializeApp({
        credential: serviceAccount
            ? firebase_admin_1.default.credential.cert(serviceAccount)
            : firebase_admin_1.default.credential.applicationDefault(),
        projectId,
    });
}
exports.default = firebase_admin_1.default;
