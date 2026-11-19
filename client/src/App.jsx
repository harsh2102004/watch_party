/**
 * @file App.jsx
 * @description Main application entry with configuration verification, Render cold-start
 * detection, top-level socket reconnection alerts, authentication guard, and route tree.
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  SocketProvider,
  RoomProvider,
  ToastProvider,
  AuthProvider,
  useSocket,
} from './context/index.js';
import { Landing, Room, Login, Register } from './pages/index.js';
import {
  ConfigErrorScreen,
  ColdStartScreen,
  ReconnectingBanner,
  ProtectedRoute,
} from './components/index.js';
import { useServerHealth } from './hooks/useServerHealth.js';

/**
 * ReconnectingBannerBridge connects the active Socket context to the ReconnectingBanner.
 * Placed inside SocketProvider to consume real-time socket lifecycle state.
 */
function ReconnectingBannerBridge() {
  const { connectionStatus } = useSocket();
  return <ReconnectingBanner isReconnecting={connectionStatus === 'reconnecting'} />;
}

/**
 * MainApp orchestrates the initial cold-start probe and environment checks.
 */
function MainApp() {
  const {
    isServerReady,
    isTimedOut,
    isConfigMissing,
    retry,
  } = useServerHealth();

  // 1. Missing VITE_SERVER_URL in production build
  if (isConfigMissing) {
    return <ConfigErrorScreen />;
  }

  // 2. Render sleeping / cold starting
  if (!isServerReady) {
    return (
      <ColdStartScreen
        isTimedOut={isTimedOut}
        onRetry={retry}
      />
    );
  }

  // 3. Fully woke up and configured: mount realtime socket and application routes
  return (
    <SocketProvider>
      <RoomProvider>
        <ReconnectingBannerBridge />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Landing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/room/:roomId"
            element={
              <ProtectedRoute>
                <Room />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RoomProvider>
    </SocketProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <MainApp />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
