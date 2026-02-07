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
  apiKey: "AIzaSyAx3BTNnEDw4AXEkk5GVR5NLeGjsfVAmlA",
  authDomain: "darkbroads.firebaseapp.com",
  projectId: "darkbroads",
  storageBucket: "darkbroads.firebasestorage.app",
  messagingSenderId: "271741371558",
  appId: "1:271741371558:web:45372043bfe9d3205ee067",
  measurementId: "G-SLEM50XYCK"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export { doc, updateDoc, arrayUnion, serverTimestamp };
