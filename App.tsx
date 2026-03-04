import React, { useState, useEffect, lazy, Suspense } from 'react';
import { EventsWidget } from './components/EventsWidget';
import { LoginPage } from './components/LoginPage';
import { EVENTS_DATA, WIJKEN_DATA } from './data';
import { EventData, Wijk } from './types';
import { API_BASE_URL, fetchWidgetData, fetchAdminData, RESTAURANT_ID } from './api';
import { Smartphone, Settings, BookOpen, Calendar as CalendarIcon, LogOut, Users, LayoutGrid, BarChart3, Loader2, Mail } from 'lucide-react';

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

const App: React.FC = () => {
  const [events, setEvents] = useState<EventData[]>(EVENTS_DATA);
  const [wijken, setWijken] = useState<Wijk[]>(WIJKEN_DATA);
  const [view, setView] = useState<ViewMode>('widget');
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

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // Show login page if not authenticated (admin access)
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
              <span className="font-bold text-lg sm:text-xl tracking-tight text-gray-900 hidden sm:inline">EVENTS <span className="text-xs text-gray-400 font-normal uppercase ml-1">Manager</span></span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {/* Desktop: full tabs with labels */}
              <div className="hidden md:flex items-center bg-gray-100 p-1 rounded-lg">
                {([
                  { key: 'widget', icon: Smartphone, label: 'Preview' },
                  { key: 'calendar', icon: CalendarIcon, label: 'Schedule' },
                  { key: 'admin', icon: Settings, label: 'Editor' },
                  { key: 'bookings', icon: Users, label: 'Boekingen' },
                  { key: 'timeline', icon: LayoutGrid, label: 'Tafels' },
                  { key: 'stats', icon: BarChart3, label: 'Stats' },
                  { key: 'newsletter', icon: Mail, label: 'Emails' },
                  { key: 'guide', icon: BookOpen, label: 'Guide' },
                ] as const).map(({ key, icon: Icon, label }) => (
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

              {/* Mobile: compact scrollable icon tabs */}
              <div className="flex md:hidden items-center gap-1 overflow-x-auto scrollbar-hide bg-gray-100 p-1 rounded-lg max-w-[calc(100vw-120px)]">
                {([
                  { key: 'widget', icon: Smartphone, label: 'Preview' },
                  { key: 'calendar', icon: CalendarIcon, label: 'Cal' },
                  { key: 'admin', icon: Settings, label: 'Edit' },
                  { key: 'bookings', icon: Users, label: 'Boek' },
                  { key: 'timeline', icon: LayoutGrid, label: 'Tafels' },
                  { key: 'stats', icon: BarChart3, label: 'Stats' },
                  { key: 'newsletter', icon: Mail, label: 'Mail' },
                  { key: 'guide', icon: BookOpen, label: 'Gids' },
                ] as const).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    onTouchStart={prefetchMap[key]}
                    className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-md transition-all min-w-[44px] ${view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[10px] font-medium leading-tight">{label}</span>
                  </button>
                ))}
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
      <main className="flex-1 py-4 sm:py-8 pb-20 md:pb-8">


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
            <div className="animate-in slide-in-from-bottom-4 duration-300">
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
            <div className="animate-in slide-in-from-bottom-4 duration-300">
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
            <div className="animate-in slide-in-from-bottom-4 duration-300">
              <Newsletter restaurantId={getRestaurantId()} />
            </div>
          </Suspense>
        )}

      </main>
    </div>
  );
};

export default App;
