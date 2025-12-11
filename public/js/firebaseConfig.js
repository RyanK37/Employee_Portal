// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyAedGQvgihBSoGNki0vz53MwwQuDfAJ7NI",
  authDomain: "employeeportal-23a05.firebaseapp.com",
  projectId: "employeeportal-23a05",
  storageBucket: "employeeportal-23a05.firebasestorage.app",
  messagingSenderId: "898798413733",
  appId: "1:898798413733:web:68d5eb68dddcaf972bea4c"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Global services
const auth = firebase.auth();
const db = firebase.firestore();
