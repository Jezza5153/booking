import React, { useState, useEffect, lazy, Suspense } from 'react';
import { EventsWidget } from './components/EventsWidget';
import { LoginPage } from './components/LoginPage';
import { EVENTS_DATA, WIJKEN_DATA } from './data';
import { EventData, Wijk } from './types';
import { API_BASE_URL, fetchWidgetData, fetchAdminData, RESTAURANT_ID } from './api';
import { Smartphone, Settings, BookOpen, Calendar as CalendarIcon, LogOut, Users, LayoutGrid, BarChart3, Loader2, Mail, ChevronRight, type LucideIcon } from 'lucide-react';

// Lazy load heavy components for faster initial load
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const IntegrationGuide = lazy(() => import('./components/IntegrationGuide').then(m => ({ default: m.IntegrationGuide })));
const CalendarManager = lazy(() => import('./components/CalendarManager').then(m => ({ default: m.CalendarManager })));
const BookingsManager = lazy(() => import('./components/BookingsManager').then(m => ({ default: m.BookingsManager })));
const TimelineGrid = lazy(() => import('./components/TimelineGrid').then(m => ({ default: m.TimelineGrid })));
const BookingStats = lazy(() => import('./components/BookingStats').then(m => ({ default: m.BookingStats })));
const Newsletter = lazy(() => import('./components/Newsletter').then(m => ({ default: m.Newsletter })));

// PERF: Prefetch map — hover over a tab starts loading its chunk before clicking
const prefetchMap: Record<string, () => void> = {
  calendar: () => { void import('./components/CalendarManager'); },
  admin: () => { void import('./components/AdminDashboard'); },
  bookings: () => { void import('./components/BookingsManager'); },
  timeline: () => { void import('./components/TimelineGrid'); },
  stats: () => { void import('./components/BookingStats'); },
  newsletter: () => { void import('./components/Newsletter'); },
  guide: () => { void import('./components/IntegrationGuide'); },
};

type ViewMode = 'widget' | 'admin' | 'guide' | 'calendar' | 'bookings' | 'timeline' | 'stats' | 'newsletter';

const VIEW_OPTIONS: Array<{
  key: ViewMode;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  mobilePrimary?: boolean;
}> = [
    { key: 'widget', icon: Smartphone, label: 'Preview', shortLabel: 'Preview' },
    { key: 'calendar', icon: CalendarIcon, label: 'Agenda', shortLabel: 'Agenda', mobilePrimary: true },
    { key: 'admin', icon: Settings, label: 'Instellingen', shortLabel: 'Instel', mobilePrimary: true },
    { key: 'bookings', icon: Users, label: 'Boekingen', shortLabel: 'Boeken', mobilePrimary: true },
    { key: 'timeline', icon: LayoutGrid, label: 'Tafels', shortLabel: 'Tafels', mobilePrimary: true },
    { key: 'stats', icon: BarChart3, label: 'Stats', shortLabel: 'Stats', mobilePrimary: true },
    { key: 'newsletter', icon: Mail, label: 'Emails', shortLabel: 'Mail' },
    { key: 'guide', icon: BookOpen, label: 'Guide', shortLabel: 'Gids' },
  ];

const App: React.FC = () => {
  const [events, setEvents] = useState<EventData[]>(EVENTS_DATA);
  const [wijken, setWijken] = useState<Wijk[]>(WIJKEN_DATA);
  const [view, setViewState] = useState<ViewMode>(() => {
    // Initialize from hash route
    const hash = window.location.hash.replace('#/', '').split('?')[0];
    const VALID_VIEWS: ViewMode[] = ['widget', 'admin', 'guide', 'calendar', 'bookings', 'timeline', 'stats', 'newsletter'];
    return VALID_VIEWS.includes(hash as ViewMode) ? (hash as ViewMode) : 'timeline';
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [sessionRestaurantId, setSessionRestaurantId] = useState<string | null>(null);

  // Get effective restaurantId: session > URL param > default
  const getRestaurantId = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlRestaurantId = urlParams.get('restaurantId');
    return sessionRestaurantId || urlRestaurantId || RESTAURANT_ID;
  };

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('events_token');
    const storedRestaurantId = localStorage.getItem('events_restaurantId');
    if (storedRestaurantId) {
      setSessionRestaurantId(storedRestaurantId);
    }
    if (token) {
      // Verify token with server (primary — blocks page load)
      fetch(`${API_BASE_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (res.ok) {
            setIsAuthenticated(true);
            // Background: silently refresh token for another 30 days (non-blocking)
            fetch(`${API_BASE_URL}/api/auth/refresh`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.ok ? r.json() : null).then(data => {
              if (data?.token) localStorage.setItem('events_token', data.token);
            }).catch(() => { });
          } else {
            localStorage.removeItem('events_token');
            localStorage.removeItem('events_user');
          }
        })
        .catch(() => {
          console.warn('Auth verification failed: server unreachable');
          localStorage.removeItem('events_token');
          localStorage.removeItem('events_user');
        })
        .finally(() => setIsCheckingAuth(false));
    } else {
      setIsCheckingAuth(false);
    }
  }, []);

  // Load data from API when authenticated
  // P0-3: Use admin endpoint for editing (raw ISO dates), widget endpoint for public view
  const loadDataFromAPI = async () => {
    try {
      // Authenticated users get admin endpoint with raw ISO dates for proper editing
      const restaurantId = getRestaurantId();
      const data = isAuthenticated
        ? await fetchAdminData(restaurantId)
        : await fetchWidgetData(restaurantId);
      setEvents(data.events);
      setWijken(data.zones);
      console.log('✅ Loaded data from API:', data.events.length, 'events');
    } catch (error) {
      console.error('Failed to load from API, using local data:', error);
    }
  };

  // Load data when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadDataFromAPI();
      // PERF: Eagerly preload service-critical views after login.
      // On iPad (no hover), this ensures chunks are ready before first tap.
      void import('./components/BookingsManager');
      void import('./components/TimelineGrid');
      void import('./components/BookingStats');
      void import('./components/AdminDashboard');
    }
  }, [isAuthenticated]);

  const handleLoginSuccess = (token: string) => {
    // Read the restaurantId that LoginPage just stored
    const storedRestaurantId = localStorage.getItem('events_restaurantId');
    if (storedRestaurantId) {
      setSessionRestaurantId(storedRestaurantId);
    }
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('events_token');
    localStorage.removeItem('events_user');
    localStorage.removeItem('events_restaurantId');
    setSessionRestaurantId(null);
    setIsAuthenticated(false);
    setView('widget');
  };

  const handleAddEvent = () => {
    const newEvent: EventData = {
      id: `new-${Date.now()}`,
      title: 'New Event',
      slots: [
        {
          id: `s-${Date.now()}-1`, date: 'Ma 01 jan', time: '18:00',
          booked2tops: 0, booked4tops: 0, booked6tops: 0,
          wijkId: wijken[0]?.id
        },
        {
          id: `s-${Date.now()}-2`, date: 'Ma 01 jan', time: '19:00',
          booked2tops: 0, booked4tops: 0, booked6tops: 0,
          wijkId: wijken[0]?.id
        }
      ]
    };
    setEvents([...events, newEvent]);
    if (view !== 'admin') setView('admin');
  };

  const handleDeleteEvent = (id: string) => {
    if (confirm('Are you sure you want to delete this event?')) {
      setEvents(events.filter(e => e.id !== id));
    }
  };

  // ── Routing: determine if we're on a public or admin route ──
  // Hash-based admin routes: #/tafels, #/admin, #/bookings, etc.
  // Root URL (no hash, or empty hash) = PUBLIC booking widget
  const ADMIN_HASHES = ['tafels', 'admin', 'calendar', 'bookings', 'timeline', 'stats', 'newsletter', 'guide', 'widget'];

  const getHashRoute = (): string | null => {
    const hash = window.location.hash.replace('#/', '').split('?')[0];
    return ADMIN_HASHES.includes(hash) ? hash : null;
  };

  const [hashRoute, setHashRoute] = useState<string | null>(getHashRoute());

  // Listen for hash changes (back/forward navigation)
  useEffect(() => {
    const onHashChange = () => {
      setHashRoute(getHashRoute());
      const hash = window.location.hash.replace('#/', '').split('?')[0];
      const VALID_VIEWS: ViewMode[] = ['widget', 'admin', 'guide', 'calendar', 'bookings', 'timeline', 'stats', 'newsletter'];
      if (VALID_VIEWS.includes(hash as ViewMode)) {
        setViewState(hash as ViewMode);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Wrapper to also update hash when changing view
  const setView = (v: ViewMode) => {
    setViewState(v);
    window.location.hash = `#/${v}`;
  };

  // Determine if this is a public page (no admin hash route)
  const isPublicPage = !hashRoute;

  // Show loading while checking auth (only for admin routes)
  if (isCheckingAuth && !isPublicPage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // PUBLIC ROUTE: Root URL always shows the booking widget
  // This is what customers see when they click the Google booking link
  if (isPublicPage) {
    return (
      <div className="w-screen h-[100dvh] bg-[#0b0b0b] relative">
        <EventsWidget
          events={events}
          wijken={wijken}
          useApi={true}
          restaurantId={getRestaurantId()}
          showHeader={true}
        />
        {/* Subtle admin link for owners — only show if authenticated */}
        {isAuthenticated && (
          <a
            href="#/tafels"
            className="fixed bottom-4 right-4 z-50 bg-white/10 hover:bg-white/20 text-white/60 hover:text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm transition-all"
          >
            Admin →
          </a>
        )}
      </div>
    );
  }

  // ADMIN ROUTE: Requires authentication
  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* Top Navigation Bar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-2 sm:px-4">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-lg tracking-wider">E</span>
              </div>
              <span className="font-bold text-sm sm:text-xl tracking-tight text-gray-900">
                EVENTS
                <span className="hidden sm:inline text-xs text-gray-400 font-normal uppercase ml-1">Manager</span>
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {/* Desktop: full tabs with labels */}
              <div className="hidden md:flex items-center bg-gray-100 p-1 rounded-lg">
                {VIEW_OPTIONS.map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    onMouseEnter={prefetchMap[key]}
                    onTouchStart={prefetchMap[key]}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 whitespace-nowrap ${view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Mobile: current view picker instead of a tiny horizontal icon rail */}
              <div className="flex md:hidden items-center gap-2">
                <label htmlFor="mobile-admin-view" className="sr-only">Admin scherm</label>
                <div className="relative min-w-[150px]">
                  <select
                    id="mobile-admin-view"
                    value={view}
                    onChange={(e) => setView(e.target.value as ViewMode)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 pr-8 text-sm font-medium text-gray-800 shadow-sm focus:border-gray-400 focus:outline-none"
                  >
                    {VIEW_OPTIONS.map(({ key, label }) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-gray-400" />
                </div>
              </div>

              {/* Logout button */}
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area — reduced padding on mobile */}
      <main className="flex-1 py-4 sm:py-8 pb-28 md:pb-8">


        {/* VIEW: WIDGET PREVIEW */}
        {view === 'widget' && (
          <div className="flex flex-col items-center justify-center gap-8 animate-in fade-in duration-500">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">Widget Preview</h2>
              <p className="text-gray-500">Preview how availability adapts to different zones.</p>
            </div>

            <div className="w-full max-w-md relative group px-4">
              <div className="absolute -top-6 left-4 text-xs font-mono text-gray-400 select-none">
                &lt;IFRAME&gt;
              </div>

              {/* The Live Widget Instance */}
              <div className="bg-[#0b0b0b] rounded-3xl border border-white/10 shadow-2xl shadow-black/30 overflow-hidden relative min-h-[600px] h-[600px]">
                <EventsWidget events={events} wijken={wijken} useApi={true} restaurantId={getRestaurantId()} />
              </div>

              <div className="absolute -bottom-6 right-4 text-xs font-mono text-gray-400 select-none">
                &lt;/IFRAME&gt;
              </div>
            </div>
          </div>
        )}

        {/* VIEW: CALENDAR APP */}
        {view === 'calendar' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-6xl mx-auto px-4">
              <CalendarManager events={events} wijken={wijken} />
            </div>
          </Suspense>
        )}

        {/* VIEW: ADMIN DASHBOARD */}
        {view === 'admin' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-bottom-4 duration-300">
              <AdminDashboard
                events={events}
                setEvents={setEvents}
                onAddEvent={handleAddEvent}
                onDeleteEvent={handleDeleteEvent}
                wijken={wijken}
                setWijken={setWijken}
                onRefresh={loadDataFromAPI}
              />
            </div>
          </Suspense>
        )}

        {/* VIEW: BOOKINGS MANAGER */}
        {view === 'bookings' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-6xl mx-auto px-4">
              <BookingsManager restaurantId={getRestaurantId()} />
            </div>
          </Suspense>
        )}

        {/* VIEW: INTEGRATION GUIDE */}
        {view === 'guide' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-right-4 duration-300">
              <IntegrationGuide />
            </div>
          </Suspense>
        )}

        {/* VIEW: TIMELINE GRID (Restaurant Tables) */}
        {view === 'timeline' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-6xl mx-auto px-4">
              <TimelineGrid restaurantId={getRestaurantId()} />
            </div>
          </Suspense>
        )}

        {/* VIEW: STATISTICS */}
        {view === 'stats' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-6xl mx-auto px-4">
              <BookingStats restaurantId={getRestaurantId()} onBack={(date?: string) => { setView('timeline'); /* date available for filtering */ }} />
            </div>
          </Suspense>
        )}

        {/* VIEW: NEWSLETTER */}
        {view === 'newsletter' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
            <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-6xl mx-auto px-4">
              <Newsletter restaurantId={getRestaurantId()} />
            </div>
          </Suspense>
        )}

      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur md:hidden">
        <div
          className="mx-auto grid max-w-lg grid-cols-5 gap-1 px-2 pt-2"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
        >
          {VIEW_OPTIONS.filter(({ mobilePrimary }) => mobilePrimary).map(({ key, icon: Icon, shortLabel }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              onTouchStart={prefetchMap[key]}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition-colors ${view === key ? 'bg-gray-900 text-white shadow-lg shadow-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Icon className="w-4 h-4" />
              <span>{shortLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
