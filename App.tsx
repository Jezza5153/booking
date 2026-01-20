import React, { useState, useEffect } from 'react';
import { EventsWidget } from './components/EventsWidget';
import { AdminDashboard } from './components/AdminDashboard';
import { IntegrationGuide } from './components/IntegrationGuide';
import { CalendarManager } from './components/CalendarManager';
import { BookingsManager } from './components/BookingsManager';
import { LoginPage } from './components/LoginPage';
import { EVENTS_DATA, WIJKEN_DATA } from './data';
import { EventData, Wijk } from './types';
import { API_BASE_URL, fetchWidgetData, fetchAdminData, RESTAURANT_ID } from './api';
import { Smartphone, Settings, BookOpen, Calendar as CalendarIcon, LogOut, Users } from 'lucide-react';

type ViewMode = 'widget' | 'admin' | 'guide' | 'calendar' | 'bookings';

// Check if we're in embed mode (public widget only, no login required)
const isEmbedMode = () => {
  const params = new URLSearchParams(window.location.search);
  // Embed mode if: ?embed=true OR in iframe OR ?widget=true
  const hasEmbedParam = params.get('embed') === 'true' || params.get('widget') === 'true';
  const isInIframe = window.self !== window.top;
  return hasEmbedParam || isInIframe;
};

const App: React.FC = () => {
  const [events, setEvents] = useState<EventData[]>(EVENTS_DATA);
  const [wijken, setWijken] = useState<Wijk[]>(WIJKEN_DATA);
  const [view, setView] = useState<ViewMode>('widget');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [embedMode] = useState(isEmbedMode());
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
      // Verify token with server
      fetch(`${API_BASE_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (res.ok) {
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem('events_token');
            localStorage.removeItem('events_user');
          }
        })
        .catch(() => {
          // Server not reachable, allow local mode
          setIsAuthenticated(true);
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
    if (isAuthenticated && !embedMode) {
      loadDataFromAPI();
    }
  }, [isAuthenticated, embedMode]);

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

  // Show loading while checking auth (skip in embed mode)
  if (isCheckingAuth && !embedMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  // EMBED MODE: Show only the public widget (no login required)
  if (embedMode) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex items-start justify-center">
        <EventsWidget events={events} wijken={wijken} useApi={true} restaurantId={getRestaurantId()} />
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
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-lg tracking-wider">E</span>
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900">EVENTS <span className="text-xs text-gray-400 font-normal uppercase ml-1">Manager</span></span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center bg-gray-100 p-1 rounded-lg overflow-x-auto">
                <button
                  onClick={() => setView('widget')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${view === 'widget' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <Smartphone className="w-4 h-4" />
                  Preview
                </button>
                <button
                  onClick={() => setView('calendar')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${view === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <CalendarIcon className="w-4 h-4" />
                  Schedule
                </button>
                <button
                  onClick={() => setView('admin')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${view === 'admin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <Settings className="w-4 h-4" />
                  Editor
                </button>
                <button
                  onClick={() => setView('bookings')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${view === 'bookings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <Users className="w-4 h-4" />
                  Boekingen
                </button>
                <button
                  onClick={() => setView('guide')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${view === 'guide' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <BookOpen className="w-4 h-4" />
                  Guide
                </button>
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

      {/* Main Content Area */}
      <main className="flex-1 py-8">

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
              <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl shadow-gray-200 overflow-hidden relative min-h-[600px] h-[600px]">
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
          <div className="animate-in slide-in-from-bottom-4 duration-300">
            <CalendarManager events={events} wijken={wijken} />
          </div>
        )}

        {/* VIEW: ADMIN DASHBOARD */}
        {view === 'admin' && (
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
        )}

        {/* VIEW: BOOKINGS MANAGER */}
        {view === 'bookings' && (
          <div className="animate-in slide-in-from-bottom-4 duration-300">
            <BookingsManager restaurantId={getRestaurantId()} />
          </div>
        )}

        {/* VIEW: INTEGRATION GUIDE */}
        {view === 'guide' && (
          <div className="animate-in slide-in-from-right-4 duration-300">
            <IntegrationGuide />
          </div>
        )}

      </main>
    </div>
  );
};

export default App;