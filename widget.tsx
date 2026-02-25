import React from 'react';
import ReactDOM from 'react-dom/client';
import { EventsWidget } from './components/EventsWidget';
import { RESTAURANT_ID } from './api';

function getRestaurantId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('restaurantId') || RESTAURANT_ID;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <EventsWidget useApi={true} restaurantId={getRestaurantId()} />
  </React.StrictMode>
);
