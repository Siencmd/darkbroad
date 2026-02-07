// Import modular Firebase API
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCf9rifuGfNqcfhOZK8Lygt43SshKaCKrQ",
  authDomain: "group9-syntax-9fb66.firebaseapp.com",
  projectId: "group9-syntax-9fb66",
  storageBucket: "group9-syntax-9fb66.firebasestorage.app",
  messagingSenderId: "463795941537",
  appId: "1:463795941537:web:37fa287c7c1e50b69040e0",
  measurementId: "G-YFBM5P78DX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Export auth to use in other scripts
export { auth };
