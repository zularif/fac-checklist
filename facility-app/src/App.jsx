import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Home from './pages/Home'
import Checklist from './pages/Checklist'
import Dashboard from './pages/Dashboard'
import Header from './components/Header'
import ErrorBoundary from './components/ErrorBoundary'

const SyncCentre = lazy(() => import('./pages/SyncCentre'))
const InspectionDetail = lazy(() => import('./pages/InspectionDetail'))
const AssetDetail = lazy(() => import('./pages/AssetDetail'))
const Scan = lazy(() => import('./pages/Scan'))
const SignOff = lazy(() => import('./pages/SignOff'))
const Admin = lazy(() => import('./pages/Admin'))
const QRLabels = lazy(() => import('./pages/QRLabels'))
const Reports = lazy(() => import('./pages/Reports'))
const EquipmentManager = lazy(() => import('./pages/EquipmentManager'))
const ChecklistManager = lazy(() => import('./pages/ChecklistManager'))
const AreaEquipment = lazy(() => import('./pages/AreaEquipment'))
const ParameterChart = lazy(() => import('./pages/ParameterChart'))
const Tasks = lazy(() => import('./pages/Tasks'))
const TaskStages = lazy(() => import('./pages/TaskStages'))
const Help = lazy(() => import('./pages/Help'))
const ChangePin = lazy(() => import('./pages/ChangePin'))
const StaffManager = lazy(() => import('./pages/StaffManager'))
const AreaManager = lazy(() => import('./pages/AreaManager'))
const History = lazy(() => import('./pages/History'))
const Setup = lazy(() => import('./pages/Setup'))
const FloorMap = lazy(() => import('./pages/fe/FloorMap'))
const FEChecklist = lazy(() => import('./pages/fe/FEChecklist'))
const FEAdmin = lazy(() => import('./pages/fe/FEAdmin'))
const FEList = lazy(() => import('./pages/fe/FEList'))
const FEReport = lazy(() => import('./pages/fe/FEReport'))
const FEQRLabels = lazy(() => import('./pages/fe/FEQRLabels'))
const FEExpiryBulk = lazy(() => import('./pages/fe/FEExpiryBulk'))
const FEExpiry = lazy(() => import('./pages/fe/FEExpiry'))

function LazyFallback() {
  return <div className="center-msg">Loading…</div>
}

function Protected({ children }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="center-msg">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile || profile.status !== 'Active') return <div className="screen">An active technician profile is required. Please reconnect or contact an administrator.</div>
  return children
}

export default function App() {
  const { session } = useAuth()
  const location = useLocation()
  const showHeader = session && location.pathname !== '/login' && location.pathname !== '/setup'

  return (
    <div className={'app-shell' + (showHeader ? ' has-nav' : '')}>
      {showHeader && <Header />}
      <div className={'app-body' + (showHeader ? ' with-header' : '')}>
        <div className="content-wrap">
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Suspense fallback={<LazyFallback />}><Setup /></Suspense>} />
          <Route path="/" element={<Protected><Home /></Protected>} />
          <Route path="/sync" element={<Protected><Suspense fallback={<LazyFallback />}><SyncCentre /></Suspense></Protected>} />
          <Route path="/inspection/:kind/:id" element={<Protected><Suspense fallback={<LazyFallback />}><InspectionDetail /></Suspense></Protected>} />
          <Route path="/asset/:kind/:code" element={<Protected><Suspense fallback={<LazyFallback />}><AssetDetail /></Suspense></Protected>} />
          <Route path="/scan" element={<Protected><Suspense fallback={<LazyFallback />}><Scan /></Suspense></Protected>} />
          <Route path="/checklist/:equipId" element={<Protected><Checklist /></Protected>} />
          <Route path="/signoff" element={<Protected><Suspense fallback={<LazyFallback />}><SignOff /></Suspense></Protected>} />
          <Route path="/signoff/:inspectionId" element={<Protected><Suspense fallback={<LazyFallback />}><SignOff /></Suspense></Protected>} />
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/area/:areaId" element={<Protected><Suspense fallback={<LazyFallback />}><AreaEquipment /></Suspense></Protected>} />
          <Route path="/parameter-chart" element={<Protected><Suspense fallback={<LazyFallback />}><ParameterChart /></Suspense></Protected>} />
          <Route path="/tasks" element={<Protected><Suspense fallback={<LazyFallback />}><Tasks /></Suspense></Protected>} />
          <Route path="/tasks/stages" element={<Protected><Suspense fallback={<LazyFallback />}><TaskStages /></Suspense></Protected>} />
          <Route path="/help" element={<Protected><Suspense fallback={<LazyFallback />}><Help /></Suspense></Protected>} />
          <Route path="/change-pin" element={<Protected><Suspense fallback={<LazyFallback />}><ChangePin /></Suspense></Protected>} />
          <Route path="/staff" element={<Protected><Suspense fallback={<LazyFallback />}><StaffManager /></Suspense></Protected>} />
          <Route path="/admin/areas" element={<Protected><Suspense fallback={<LazyFallback />}><AreaManager /></Suspense></Protected>} />
          <Route path="/history" element={<Protected><Suspense fallback={<LazyFallback />}><History /></Suspense></Protected>} />
          <Route path="/fe" element={<Protected><Suspense fallback={<LazyFallback />}><FloorMap /></Suspense></Protected>} />
          <Route path="/fe/checklist/:feCode" element={<Protected><Suspense fallback={<LazyFallback />}><FEChecklist /></Suspense></Protected>} />
          <Route path="/fe/admin" element={<Protected><Suspense fallback={<LazyFallback />}><FEAdmin /></Suspense></Protected>} />
          <Route path="/fe/list" element={<Protected><Suspense fallback={<LazyFallback />}><FEList /></Suspense></Protected>} />
          <Route path="/fe/report" element={<Protected><Suspense fallback={<LazyFallback />}><FEReport /></Suspense></Protected>} />
          <Route path="/fe/qr-labels" element={<Protected><Suspense fallback={<LazyFallback />}><FEQRLabels /></Suspense></Protected>} />
          <Route path="/fe/expiry-bulk" element={<Protected><Suspense fallback={<LazyFallback />}><FEExpiryBulk /></Suspense></Protected>} />
          <Route path="/fe/expiry" element={<Protected><Suspense fallback={<LazyFallback />}><FEExpiry /></Suspense></Protected>} />
          <Route path="/admin" element={<Protected><Suspense fallback={<LazyFallback />}><Admin /></Suspense></Protected>} />
          <Route path="/admin/qr-labels" element={<Protected><Suspense fallback={<LazyFallback />}><QRLabels /></Suspense></Protected>} />
          <Route path="/admin/reports" element={<Protected><Suspense fallback={<LazyFallback />}><Reports /></Suspense></Protected>} />
          <Route path="/admin/equipment" element={<Protected><Suspense fallback={<LazyFallback />}><EquipmentManager /></Suspense></Protected>} />
          <Route path="/admin/checklist/:equipId" element={<Protected><Suspense fallback={<LazyFallback />}><ChecklistManager /></Suspense></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
