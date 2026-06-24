import { initializeApp } from "firebase/app";
import { initializeFirestore, getFirestore, doc, getDocFromServer } from "firebase/firestore";

// Public Firebase config credentials
const firebaseConfig = {
  apiKey: "AIzaSyA3_wkhQEPUpn4b4RwvIVKNKLaySnA6z5I",
  authDomain: "worldcup-ver2.firebaseapp.com",
  databaseURL: "https://worldcup-ver2-default-rtdb.firebaseio.com",
  projectId: "worldcup-ver2",
  storageBucket: "worldcup-ver2.firebasestorage.app",
  messagingSenderId: "753840629017",
  appId: "1:753840629017:web:0d7f063b05381756b39188",
  measurementId: "G-3R5LTECEXB"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

let db;
try {
  // Initialize Firestore with default database and experimentalForceLongPolling (for school firewall bypass)
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true
  });
  console.log("Firestore initialized with default database and long polling.");
} catch (e) {
  console.warn("Firestore initialization with long polling failed, falling back to getFirestore.", e);
  db = getFirestore(app);
}

// Validate connection on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "classes", "test_conn"));
    console.log("Firestore connection test successfully resolved.");
  } catch (error) {
    console.warn("Firestore connection check info:", error.message);
  }
}

testConnection();

export { app, db };
