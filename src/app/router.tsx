import { PlantLoader } from '@/components/PlantLoader'
import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RequirePrivateAccess } from '@/features/private-access/components/RequirePrivateAccess'
import { ScanFlowLayout } from '@/features/scan/ScanFlowLayout'
import { PrivateAccessRouteGuard } from '@/features/private-access/components/PrivateAccessRouteGuard'
import { RestorePrivateAccessPage } from '@/features/private-access/pages/RestorePrivateAccessPage'
import { RecoveryKitSetupPage } from '@/features/private-access/pages/RecoveryKitSetupPage'
import { WelcomePage } from '@/features/welcome/WelcomePage'
import { WelcomeRoute } from '@/features/welcome/WelcomeRoute'

// I lazy load these because MapLibre especially is a pretty big chunk, and
// bundling it into the main entry meant the welcome screen (which is
// the very first thing anyone sees) was loading way slower than it needed to
// on a bad connection. Splitting per route fixed that.
const ThreatMapPage = lazy(() => import('@/features/map/ThreatMapPage')
  .then((module) => ({ default: module.ThreatMapPage })))
const AccessManagementPage = lazy(() => import('@/features/private-access/pages/AccessManagementPage')
  .then((module) => ({ default: module.AccessManagementPage })))
const ScanCapturePage = lazy(() => import('@/features/scan/ScanCapturePage')
  .then((module) => ({ default: module.ScanCapturePage })))
const ScanResultPage = lazy(() => import('@/features/scan/ScanResultPage')
  .then((module) => ({ default: module.ScanResultPage })))
const ReportWizardPage = lazy(() => import('@/features/report/ReportWizardPage')
  .then((module) => ({ default: module.ReportWizardPage })))
const ReportTrackingPage = lazy(() => import('@/features/report/ReportTrackingPage')
  .then((module) => ({ default: module.ReportTrackingPage })))
const MyReportsPage = lazy(() => import('@/features/report/MyReportsPage')
  .then((module) => ({ default: module.MyReportsPage })))
const CataloguePage = lazy(() => import('@/features/catalogue/CataloguePage')
  .then((module) => ({ default: module.CataloguePage })))
const CatalogueDetailPage = lazy(() => import('@/features/catalogue/CatalogueDetailPage')
  .then((module) => ({ default: module.CatalogueDetailPage })))
const AdoptedAreasPage = lazy(() => import('@/features/adopted-areas/AdoptedAreasPage')
  .then((module) => ({ default: module.AdoptedAreasPage })))
const AdoptedAreaActivityPage = lazy(() => import('@/features/adopted-areas/AdoptedAreaActivityPage')
  .then((module) => ({ default: module.AdoptedAreaActivityPage })))
const PlacesPage = lazy(() => import('@/features/places/PlacesPage')
  .then((module) => ({ default: module.PlacesPage })))
const PlaceDetailPage = lazy(() => import('@/features/places/PlaceDetailPage')
  .then((module) => ({ default: module.PlaceDetailPage })))
const GuidedMissionPage = lazy(() => import('@/features/guided-missions/GuidedMissionPage')
  .then((module) => ({ default: module.GuidedMissionPage })))
const FollowUpPage = lazy(() => import('@/features/follow-up/FollowUpPage')
  .then((module) => ({ default: module.FollowUpPage })))
const EventsDiscoveryPage = lazy(() => import('@/features/events/EventsDiscoveryPage').then((module) => ({ default: module.EventsDiscoveryPage })))
const EventDetailPage = lazy(() => import('@/features/events/EventDetailPage').then((module) => ({ default: module.EventDetailPage })))
const EventCheckInPage = lazy(() => import('@/features/events/EventCheckInPage').then((module) => ({ default: module.EventCheckInPage })))
const EventTaskPage = lazy(() => import('@/features/events/EventTaskPage').then((module) => ({ default: module.EventTaskPage })))
const EventSummaryPage = lazy(() => import('@/features/events/EventSummaryPage').then((module) => ({ default: module.EventSummaryPage })))
const HostEventPage = lazy(() => import('@/features/events/HostEventPage').then((module) => ({ default: module.HostEventPage })))
const MyHostedEventsPage = lazy(() => import('@/features/events/MyHostedEventsPage').then((module) => ({ default: module.MyHostedEventsPage })))

// small helper so I don't have to wrap every single lazy route in its own
// Suspense manually - also means one slow chunk loading doesn't block AppShell
// or the rest of the route tree from rendering around it
function loadRoute(content: ReactNode, showLoader = true) {
  return <Suspense fallback={showLoader ? <RouteLoadingState /> : <span className="sr-only" role="status">Loading map…</span>}>{content}</Suspense>
}

function RouteLoadingState() {
  return (
    <section className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <PlantLoader label="Loading this page…" />
    </section>
  )
}

// The public welcome page comes first: "/" is readable without any identity
// (WelcomeRoute sends an existing profile on to /map), and /welcome always
// shows it. Neither sits inside RequirePrivateAccess.
//
// The rest of the tree is three groups, roughly matching the three states a
// user can be in. First is the /private-access flow (restore and recovery
// kit) for anyone without a finished profile - PrivateAccessRouteGuard redirects away from it once a
// profile exists so people can't land back on the setup screen. Second is
// the normal AppShell layout, gated by RequirePrivateAccess so nothing in
// here can render without a profile. Third is /scan and /report, which
// skip AppShell on purpose - for those I wanted a focused screen with no
// sidebar or tabs getting in the way while someone's mid-scan.
export const router = createBrowserRouter([
  { path: '/', element: <WelcomeRoute /> },
  { path: '/welcome', element: <WelcomePage /> },
  {
    path: '/auth/*',
    element: <Navigate to="/" replace />,
  },
  {
    path: '/private-access',
    element: <PrivateAccessRouteGuard />,
    children: [
      // The old private-access landing page is gone; the welcome page at "/"
      // is the only start screen now.
      { index: true, element: <Navigate to="/" replace /> },
      { path: 'restore', element: <RestorePrivateAccessPage /> },
      { path: 'recovery', element: <RecoveryKitSetupPage /> },
    ],
  },
  {
    // Pathless layout: the children keep their URLs (/map, /profile, ...)
    // but "/" itself now belongs to the welcome page above.
    element: <RequirePrivateAccess><AppShell /></RequirePrivateAccess>,
    children: [
      { path: 'map', element: loadRoute(<ThreatMapPage />, false) },
      { path: 'profile', element: loadRoute(<AccessManagementPage />) },
      { path: 'access', element: <Navigate to="/profile" replace /> },
      { path: 'reports', element: loadRoute(<MyReportsPage />) },
      { path: 'reports/:reportId', element: loadRoute(<ReportTrackingPage />) },
      { path: 'catalogue', element: loadRoute(<CataloguePage />) },
      { path: 'catalogue/:speciesId', element: loadRoute(<CatalogueDetailPage />) },
      { path: 'adopted-areas', element: loadRoute(<AdoptedAreasPage />) },
      { path: 'adopted-areas/:adoptionId/activity', element: loadRoute(<AdoptedAreaActivityPage />) },
      { path: 'places', element: loadRoute(<PlacesPage />) },
      { path: 'places/:placeId', element: loadRoute(<PlaceDetailPage />) },
      { path: 'places/:placeId/mission', element: loadRoute(<GuidedMissionPage />) },
      { path: 'sightings/:sightingId/follow-up/*', element: loadRoute(<FollowUpPage />) },
      { path: 'events', element: loadRoute(<EventsDiscoveryPage />) },
      { path: 'events/mine', element: loadRoute(<MyHostedEventsPage />) },
      { path: 'events/host', element: loadRoute(<HostEventPage />) },
      { path: 'events/:eventId', element: loadRoute(<EventDetailPage />) },
      { path: 'events/:eventId/edit', element: loadRoute(<HostEventPage />) },
      { path: 'events/:eventId/check-in', element: loadRoute(<EventCheckInPage />) },
      { path: 'events/:eventId/tasks', element: loadRoute(<EventTaskPage />) },
      { path: 'events/:eventId/summary', element: loadRoute(<EventSummaryPage />) },
      { path: '*', element: <Navigate to="/map" replace /> },
    ],
  },
  {
    path: '/scan',
    element: <RequirePrivateAccess><ScanFlowLayout /></RequirePrivateAccess>,
    children: [
      { index: true, element: loadRoute(<ScanCapturePage />) },
      { path: 'result', element: loadRoute(<ScanResultPage />) },
    ],
  },
  {
    path: '/report',
    element: <RequirePrivateAccess>{loadRoute(<ReportWizardPage />)}</RequirePrivateAccess>,
  },
])
