import React, { useState } from 'react';
import { Copy, Check, Code, Layout, Globe, Calendar } from 'lucide-react';
import { API_BASE_URL, RESTAURANT_ID, getCalendarUrl } from '../api';

export const IntegrationGuide: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  // Dynamic widget URL based on API
  const widgetUrl = `${API_BASE_URL.replace('localhost', 'YOUR_DOMAIN')}/widget/${RESTAURANT_ID}`;
  const calendarUrl = getCalendarUrl(RESTAURANT_ID, false);

  const embedCode = `<iframe 
  src="${widgetUrl}" 
  width="100%" 
  height="600" 
  frameborder="0" 
  style="border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);"
></iframe>`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-10">

      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">How to Embed EVENTS</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Add the discovery widget to your existing restaurant website in 3 simple steps.
        </p>
      </div>

      {/* Step 1: The Code */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
            <Code className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900">1. Copy the Widget Code</h3>
            <p className="text-gray-500 mt-1">This HTML snippet creates the window that displays your events.</p>
          </div>
        </div>
        <div className="bg-gray-900 p-6 relative group">
          <pre className="text-gray-300 font-mono text-sm overflow-x-auto p-2">
            {embedCode}
          </pre>
          <button
            onClick={() => handleCopy(embedCode, 'embed')}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors backdrop-blur-sm"
          >
            {copied === 'embed' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Step 2: Placement */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
          <Layout className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">2. Paste into your Website Builder</h3>
          <p className="text-gray-500 mt-2 leading-relaxed">
            Open your website editor (WordPress, Squarespace, Wix, or custom HTML). Find the section where you want the booking options to appear—usually on a "Reservations" or "Special Events" page.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
              <strong>WordPress:</strong> Use a "Custom HTML" block.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
              <strong>Squarespace:</strong> Use a "Code" block.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
              <strong>Wix:</strong> Use "Embed HTML" element.
            </li>
          </ul>
        </div>
      </div>

      {/* Step 3: Link Handoff */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
          <Globe className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">3. Configure Handoff URLs</h3>
          <p className="text-gray-500 mt-2">
            In the Admin Dashboard, ensure your "Book" buttons point to your actual booking engine (e.g., Formitable, Resengo, or OpenTable) with the specific date/time pre-filled.
          </p>
        </div>
      </div>

      {/* Bonus: Calendar Sync */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900">Bonus: Calendar Subscription</h3>
            <p className="text-gray-600 mt-1">
              Subscribe to your bookings feed on iPhone, Android, or Google Calendar.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-indigo-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">iCal Feed URL</span>
            <button
              onClick={() => handleCopy(calendarUrl, 'calendar')}
              className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              {copied === 'calendar' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied === 'calendar' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <code className="text-xs text-gray-500 break-all block bg-gray-50 p-2 rounded">{calendarUrl}</code>
        </div>

        <div className="text-xs text-gray-500">
          <strong>Tip:</strong> Add <code className="bg-white px-1 py-0.5 rounded">?booked_only=true</code> to only show slots with bookings.
        </div>
      </div>

    </div>
  );
};