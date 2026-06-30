import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './AuthContext.jsx'
import './index.css'
import { seedDataIfEmpty } from './helpers/seedData.js'
import { migrateBookingRefs } from './helpers/storage.js'

// Run one-time mock data seeding
seedDataIfEmpty();

// Backfill booking_ref on bookings created before grouping existed
migrateBookingRefs();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
