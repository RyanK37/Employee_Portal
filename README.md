# FDM Employee Portal

React + Firebase employee portal with leave management, chat, reports, payroll, documents, and AI-assisted mood/MBTI features.

## Stack

- React 18
- Vite
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- `@gradio/client` for mood and MBTI classifiers

## Current Product Scope

### Authentication

- Email/password sign-in only
- Restricted to workplace email addresses
- No public sign-up flow
- No Google sign-in
- First login can auto-create the base Firestore employee profile, then complete onboarding

### Core Modules

- Dashboard
  - leave balance
  - pending approvals
  - unread message count
  - recent messages
  - announcements
- Leave
  - submit leave requests
  - manager/admin approve or deny
  - leave balance updates on approval
- Messages
  - public channels
  - direct messages
  - group chats
  - announcement channel for manager/admin posting
  - optional mood and MBTI badges on messages
- Directory
  - searchable employee directory
  - MBTI and mood display
- Reports
  - analytics-style overview for leave, mood, messaging, and payroll summaries
  - leave detail table visible only to manager/admin
- Payroll
  - employee self-view for published payroll
  - manager/admin can manage payroll entries
  - payslips stored in Firebase Storage
- Documents
  - Firebase Storage-backed uploads
  - manager/admin can delete uploaded files
- Profile and Settings
  - edit employee details
  - change password for email/password accounts
  - MBTI setup/update
  - message preferences

## AI Features

- Emotion classifier: `Win02/emotion-classifier`
  - used for mood detection in chat
- MBTI classifier: `Win02/mbti-predictor`
  - used for weekly MBTI refresh based on message history

### MBTI Refresh

- Triggered when a manager/admin enters the app
- Runs at most once every 7 days
- Uses recent non-announcement message history
- Updates employee `mbti` values in Firestore
- Shows a modal to users when their MBTI changes

## Project Structure

```text
fdm-portal/
├── src/
│   ├── components/
│   │   ├── AnnouncementCard.jsx
│   │   ├── DashboardLayout.jsx
│   │   └── MbtiModal.jsx
│   ├── hooks/
│   │   ├── useAuth.jsx
│   │   ├── useTheme.jsx
│   │   └── useWeeklyMbtiRefresh.jsx
│   ├── pages/
│   │   ├── ChatPage.jsx
│   │   ├── DashboardPage.jsx
│   │   ├── DirectoryPage.jsx
│   │   ├── DocumentsPage.jsx
│   │   ├── LeavePage.jsx
│   │   ├── LoginPage.jsx
│   │   ├── PayrollPage.jsx
│   │   ├── ProfilePage.jsx
│   │   ├── ReportsPage.jsx
│   │   ├── SettingsPage.jsx
│   │   └── *.module.css
│   ├── styles/
│   │   └── global.css
│   ├── utils/
│   │   ├── ai.js
│   │   ├── chat.js
│   │   ├── display.js
│   │   ├── messages.js
│   │   ├── notifications.js
│   │   ├── payroll.js
│   │   ├── preferences.js
│   │   └── roles.js
│   ├── App.jsx
│   ├── firebase.js
│   └── main.jsx
├── firebase.json
├── firestore.indexes.json
├── firestore.rules
├── storage.rules
├── package.json
└── README.md
```

## Local Development

### Install

```bash
npm install
```

### Start dev server

```bash
npm run dev
```

Default local URL:

```text
http://localhost:5173
```

### Production build

```bash
npm run build
```

## Firebase Setup

Project currently targets:

```text
employee-portal-v2-bbe68
```

Enable these Firebase products:

- Authentication
  - Email/Password
- Firestore Database
- Firebase Storage
- Firebase Hosting

### Deploy

```bash
firebase deploy
```

Or deploy specific services:

```bash
firebase deploy --only hosting
firebase deploy --only firestore
firebase deploy --only storage
```

## Firestore / Storage Notes

- User profiles are stored in `users/{uid}`
- The Firestore document id must match the Firebase Auth `uid`
- Payroll metadata is stored in Firestore
- Payslip PDFs are stored in Firebase Storage
- Documents are stored in Firebase Storage with Firestore metadata

## Important Access Rules

- Employees can only access their own published payroll
- Managers and admins can manage payroll and delete documents
- Leave approval actions are restricted by role
- Message reads are restricted for private/group conversations
- Reports expose leave details only to manager/admin

## Current Limitations

- Email notifications are not implemented
- Push notifications are not implemented
- Online presence is not implemented
- The app uses client-driven Firebase logic; there is no backend service layer

## Classifier Dependencies

The app expects these Gradio endpoints to be reachable at runtime:

- `Win02/emotion-classifier`
- `Win02/mbti-predictor`

If those services are unavailable, chat mood prediction and MBTI refresh will fall back gracefully but will not produce new predictions.
