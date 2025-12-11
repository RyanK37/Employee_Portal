# Employee Portal (Firebase)

HTML/CSS/JS employee portal served via Firebase Hosting with Auth and Firestore for data. Includes announcements, chat, profile editing, and leave approvals for admins.

## Features
- Email/password authentication (Firebase Auth)
- Dashboard announcements with likes and an admin-only composer
- Leave requests with admin approval workflow
- Profile editing (avatar, job title, phone)
- Public and private chat threads

## Project layout
- `public/html/`: entry pages (`index.html`, `login.html`, `signup.html`, `profile.html`, `chat.html`)
- `public/js/`: Firebase configuration with auth, dashboard (announcements/leave/profile), and chat logic
- `public/css/styles.css`: shared styling/theme
- `public/assets/`: static assets (e.g., placeholder avatar)

## Prerequisites
- Node.js and Firebase CLI (`npm install -g firebase-tools`)
- Firebase project with Email/Password Auth and Firestore enabled

## Configure Firebase
1) In the Firebase console, grab your web app config and update `public/js/firebaseConfig.js`.
2) Example structure:
```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
firebase.initializeApp(firebaseConfig);
```
3) Ensure Firestore rules allow authenticated reads/writes and admins to approve leave.

## Run locally
```bash
firebase serve 
```
Open http://localhost:5000/html/login.html (or `/html/index.html`) once the server starts.

## Admin access
Set an admin flag on the user document in the `users` collection:
- Preferred: `role` = `admin`
- Alternative: `isAdmin` = true

Admins see the announcement composer and pending leave approvals in `profile.html`.

## Data outline
- `users`: name, email, profileImage, jobTitle, phone, role/isAdmin
- `leaveRequests`: request details and status
- `announcements`: message, author, likes
- `messages`/`threads`: public or private chat content

## Deploy
Deploy to Firebase Hosting once configured:
```bash
firebase deploy 
```
