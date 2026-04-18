import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './components/DashboardLayout'
import DashboardPage from './pages/DashboardPage'
import LeavePage from './pages/LeavePage'
import ChatPage from './pages/ChatPage'
import DirectoryPage from './pages/DirectoryPage'
import ReportsPage from './pages/ReportsPage'
import PayrollPage from './pages/PayrollPage'
import DocumentsPage from './pages/DocumentsPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'

function PrivateRoute({ children }) {
  const { user, loading, profileLoading, profile } = useAuth()
  if (loading || profileLoading) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="spinner" style={{ width:32, height:32 }} />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (profile === null) return <Navigate to="/login?setup=missing" replace />
  return children
}

function PublicRoute({ children, allowIncompleteProfile = false }) {
  const { user, loading, profileLoading, profile } = useAuth()
  if (loading || profileLoading) return null
  if (!user) return children
  if (allowIncompleteProfile && profile === null) return children
  if (profile === null) return <Navigate to="/login?setup=missing" replace />
  return <Navigate to="/" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"  element={<LoginPage />} />
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      <Route path="/" element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
        <Route index           element={<DashboardPage />} />
        <Route path="leave"    element={<LeavePage />} />
        <Route path="chat"     element={<ChatPage />} />
        <Route path="directory"element={<DirectoryPage />} />
        <Route path="reports"  element={<ReportsPage />} />
        <Route path="payroll"  element={<PayrollPage />} />
        <Route path="documents"element={<DocumentsPage />} />
        <Route path="profile"  element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
