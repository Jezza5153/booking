import React from 'react';
import { EventsWidget } from './components/EventsWidget';
import { RESTAURANT_ID } from './api';

function getEmbedRestaurantId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('restaurantId') || RESTAURANT_ID;
}

const EmbedApp: React.FC = () => {
  return (
    <div className="h-full bg-transparent">
      <EventsWidget useApi={true} restaurantId={getEmbedRestaurantId()} />
    </div>
  );
};

export default EmbedApp;
