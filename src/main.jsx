import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './AuthContext.jsx'
import './index.css'
import { migrateBookingRefs } from './helpers/storage.js'

// Mock data seeding is retired: finance records now live in the database and
// are loaded after login (see loadFinanceData in helpers/storage.js).

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
