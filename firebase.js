// Import modular Firebase API
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBBnAXVwZJXc1hf7Q5KNnRTBjGC1MOoy9c",
  authDomain: "darksbord.firebaseapp.com",
  projectId: "darksbord",
  storageBucket: "darksbord.firebasestorage.app",
  messagingSenderId: "568179041668",
  appId: "1:568179041668:web:075eb56e6808fffa8469d1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Export auth to use in other scripts
export { auth };
