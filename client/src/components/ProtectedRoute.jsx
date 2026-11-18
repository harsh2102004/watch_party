/**
 * @file ProtectedRoute.jsx
 * @description Route guard that requires an active authenticated session or guest mode.
 * If unauthorized, redirects to /login and preserves the target URL in location.state
 * so the user returns seamlessly to their destination (e.g. /room/:roomId) upon logging in.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/index.js';

export function ProtectedRoute({ children }) {
  const { user, isGuest, allowGuests, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0f172a)',
        color: 'var(--text-muted, #94a3b8)',
        fontSize: '1rem',
        fontWeight: 500,
      }}>
        Loading session...
      </div>
    );
  }

  const isAuthorized = Boolean(user) || allowGuests || isGuest;

  if (!isAuthorized) {
    // Preserve requested location for post-login redirect
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
