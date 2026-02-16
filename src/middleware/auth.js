const admin = require("firebase-admin");

function initFirebaseAdmin() {
  // Check if already initialized
  if (admin.apps.length > 0) {
    console.log("✅ Firebase Admin already initialized for project:", admin.app().options.projectId);
    return;
  }

  // Build service account from environment variables
  const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
  };

  if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
    throw new Error(
      "Firebase credentials missing in .env file. Check FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL."
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("✅ Firebase Admin initialized for project:", serviceAccount.project_id);
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
