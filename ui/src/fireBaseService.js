import { getFirestore } from "firebase/firestore";

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use

const firebaseConfig = {
  apiKey: "AIzaSyByoNSiZOvKQyHJMIT9n1HGoVCB87dAdDU",
  authDomain: "badminton-ledger.firebaseapp.com",
  projectId: "badminton-ledger",
  storageBucket: "badminton-ledger.firebasestorage.app",
  messagingSenderId: "280416184130",
  appId: "1:280416184130:web:874a899ee463759b9b4adb",
  measurementId: "G-NKTRTGYQ9C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app); // Initialize Firestore
const analytics = getAnalytics(app);


export {db}