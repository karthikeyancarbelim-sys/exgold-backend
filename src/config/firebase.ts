import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

type FirebaseServiceAccount = admin.ServiceAccount & {
  project_id?: string;
  projectId?: string;
};

const serviceAccountFromEnvironment = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    return JSON.parse(raw) as FirebaseServiceAccount;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
};

const serviceAccountFromFile = () => {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(__dirname, "firebase.json"),
    path.join(process.cwd(), "dist", "config", "firebase.json"),
    path.join(process.cwd(), "src", "config", "firebase.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const credentialPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!credentialPath) return null;

  try {
    return JSON.parse(fs.readFileSync(credentialPath, "utf8")) as FirebaseServiceAccount;
  } catch {
    throw new Error("Firebase service account file is not valid JSON");
  }
};

if (!admin.apps.length) {
  const serviceAccount = serviceAccountFromEnvironment() || serviceAccountFromFile();
  const projectId =
    serviceAccount?.projectId ||
    serviceAccount?.project_id ||
    process.env.FIREBASE_PROJECT_ID ||
    "ex-gold";

  admin.initializeApp({
    credential: serviceAccount
      ? admin.credential.cert(serviceAccount)
      : admin.credential.applicationDefault(),
    projectId,
  });
}

export default admin;
