const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return;

  const saPath = path.join(process.cwd(), "firebaseServiceAccount.json");
  if (!fs.existsSync(saPath)) {
    throw new Error(
      "firebaseServiceAccount.json missing. Add it in backend root (DO NOT COMMIT)."
    );
  }

  const serviceAccount = require(saPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  initialized = true;
  console.log("✅ Firebase Admin initialized");
}

async function requireAuth(req, res, next) {
  try {
    initFirebaseAdmin();
  console.log("Incoming Authorization header:", req.headers.authorization ? "present" : "missing");

    const auth = req.headers.authorization || "";
    const match = auth.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.user = { uid: decoded.uid, email: decoded.email || "" };
    return next();
  } catch (e) {
      console.error("Firebase verifyIdToken failed:", e);
    return res.status(401).json({ error: "Invalid token", detail: e.message });
  }
}

module.exports = { requireAuth };
