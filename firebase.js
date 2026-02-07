import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { 
  getAuth 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import { 
  getFirestore, 
  doc, 
  updateDoc, 
  arrayUnion, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBnAXVwZJXc1hf7Q5KNnRTBjGC1MOoy9c",
  authDomain: "darksbord.firebaseapp.com",
  projectId: "darksbord",
  storageBucket: "darksbord.firebasestorage.app",
  messagingSenderId: "568179041668",
  appId: "1:568179041668:web:075eb56e6808fffa8469d1"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export { doc, updateDoc, arrayUnion, serverTimestamp };
