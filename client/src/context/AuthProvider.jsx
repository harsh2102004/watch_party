/**
 * @file AuthProvider.jsx
 * @description Provides authentication state (user, token, guest status) and methods
 * (login, register, logout, continueAsGuest) to the React application.
 *
 * Security Note: localStorage vs. httpOnly Cookies Trade-off
 * -------------------------------------------------------------
 * We store the JWT authentication token in `localStorage` ('wp_auth_token').
 * Trade-off Analysis:
 * 1. Vulnerability: In a browser environment, localStorage is accessible to JavaScript.
 *    If an attacker manages to execute Cross-Site Scripting (XSS), the token could be stolen.
 * 2. Benefits for Real-time SPA:
 *    - Cross-Transport Availability: WebSockets (Socket.IO) require sending the token
 *      in the handshake `auth: { token }` payload, which is trivial with localStorage.
 *    - Port/Domain Decoupling: In local dev or cloud microservices (e.g. Vite on 5173,
 *      Node server on 4000), localStorage bypasses complex SameSite/CORS cookie negotiation.
 *    - CSRF Immunity: Because tokens must be explicitly attached in Authorization headers
 *      rather than sent automatically by the browser, API calls are immune to CSRF attacks.
 * In a hardened production architecture with Server-Side Rendering (SSR), httpOnly Secure
 * cookies with anti-CSRF tokens would be preferred for high-value user authentication.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AuthContext } from './AuthContext.js';
import { getServerUrl } from '../utils/config.js';

const STORAGE_KEY = 'wp_auth_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [guestName, setGuestName] = useState(null);
  const [allowGuests, setAllowGuests] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Fetch server auth configuration (guest enablement) on mount
  useEffect(() => {
    let isMounted = true;

    async function fetchConfig() {
      const serverUrl = getServerUrl();
      if (!serverUrl) return;
      try {
        const res = await fetch(`${serverUrl}/auth/config`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAllowGuests(data.allowGuests !== false);
          }
        }
      } catch {
        console.warn('[Auth] Failed to load server auth config; defaulting allowGuests to true.');
      }
    }

    fetchConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Hydrate user session from token on mount
  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      const storedToken = localStorage.getItem(STORAGE_KEY);
      if (!storedToken) {
        if (isMounted) setIsLoading(false);
        return;
      }

      const serverUrl = getServerUrl();
      if (!serverUrl) {
        if (isMounted) setIsLoading(false);
        return;
      }

      try {
        const res = await fetch(`${serverUrl}/auth/me`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setUser(data.user);
            setToken(storedToken);
            setIsGuest(false);
          }
        } else {
          // Token is expired or invalid
          localStorage.removeItem(STORAGE_KEY);
          if (isMounted) {
            setToken(null);
            setUser(null);
          }
        }
      } catch (err) {
        console.warn('[Auth] Error fetching current user:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadCurrentUser();
    return () => {
      isMounted = false;
    };
  }, [token]);

  // 3. User Login
  const login = useCallback(async ({ email, username, password }) => {
    setIsLoading(true);
    const serverUrl = getServerUrl();
    if (!serverUrl) {
      setIsLoading(false);
      throw new Error('Server URL is not configured.');
    }

    try {
      const res = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed. Please check your credentials.');
      }

      localStorage.setItem(STORAGE_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      setIsGuest(false);
      setGuestName(null);

      // Trigger custom event so SocketProvider reconnects immediately with new token
      window.dispatchEvent(new CustomEvent('auth:login', { detail: { token: data.token } }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 4. User Registration
  const register = useCallback(async ({ email, username, password }) => {
    setIsLoading(true);
    const serverUrl = getServerUrl();
    if (!serverUrl) {
      setIsLoading(false);
      throw new Error('Server URL is not configured.');
    }

    try {
      const res = await fetch(`${serverUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Registration failed. Please check your details.');
      }

      localStorage.setItem(STORAGE_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      setIsGuest(false);
      setGuestName(null);

      window.dispatchEvent(new CustomEvent('auth:login', { detail: { token: data.token } }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 5. Continue as Guest
  const continueAsGuest = useCallback((name = '') => {
    setIsGuest(true);
    setGuestName(name || null);
    window.dispatchEvent(new CustomEvent('auth:guest', { detail: { username: name } }));
  }, []);

  // 6. Logout
  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
    setIsGuest(false);
    setGuestName(null);

    window.dispatchEvent(new CustomEvent('auth:logout'));
  }, []);

  const value = {
    user,
    token,
    isGuest,
    guestName,
    allowGuests,
    isLoading,
    login,
    register,
    continueAsGuest,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
