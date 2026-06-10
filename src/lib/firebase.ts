import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC4W2GyXTnKCW1JhT_neqXRuML7X17RO8I",
  authDomain: "wave-hris-fb.firebaseapp.com",
  projectId: "wave-hris-fb",
  storageBucket: "wave-hris-fb.firebasestorage.app",
  messagingSenderId: "1059074578468",
  appId: "1:1059074578468:web:37da08fc701e090cf3e0b1",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export default app;
