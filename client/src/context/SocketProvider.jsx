import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Badge } from '../components/common/Badge.jsx';
import { SOCKET_EVENTS } from '../utils/constants.js';
import { getServerUrl } from '../utils/config.js';
import { SocketContext } from './SocketContext.js';
import { useSocket } from './useSocket.js';

/**
 * SocketProvider encapsulates a single socket.io-client instance with automatic
 * reconnection enabled, lifecycle event monitoring, and exposes state via useSocket.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.serverUrl] - Optional URL override for testing or multi-environment.
 */
export function SocketProvider({ children, serverUrl = getServerUrl() || 'http://localhost:4000' }) {
  // Initialize the single socket instance once during component mount with auth token
  const [socket] = useState(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_auth_token') : null;
    return io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
      transports: ['websocket', 'polling'],
      auth: { token: token || undefined },
    });
  });

  const [isConnected, setIsConnected] = useState(socket.connected);
  const [connectionStatus, setConnectionStatus] = useState(
    /** @type {import('./SocketContext.js').ConnectionStatus} */ (socket.connected ? 'connected' : 'connecting')
  );
  const [lastError, setLastError] = useState(/** @type {Error|null} */ (null));

  // Reconnect socket whenever authentication state updates (login, logout, guest transition)
  useEffect(() => {
    if (!socket) return;

    const handleAuthChange = () => {
      const token = localStorage.getItem('wp_auth_token');
      socket.auth = { token: token || undefined };
      socket.disconnect().connect();
    };

    window.addEventListener('auth:login', handleAuthChange);
    window.addEventListener('auth:logout', handleAuthChange);
    window.addEventListener('auth:guest', handleAuthChange);

    return () => {
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
      window.removeEventListener('auth:guest', handleAuthChange);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => {
      setIsConnected(true);
      setConnectionStatus('connected');
      setLastError(null);
    };

    const onDisconnect = (reason) => {
      setIsConnected(false);
      setConnectionStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
    };

    const onConnectError = (err) => {
      setIsConnected(false);
      setConnectionStatus('error');
      setLastError(err);
    };

    const onReconnectAttempt = () => {
      setConnectionStatus('reconnecting');
    };

    const onReconnect = () => {
      setIsConnected(true);
      setConnectionStatus('connected');
      setLastError(null);
    };

    const onSessionReplaced = (data) => {
      setIsConnected(false);
      setConnectionStatus('disconnected');
      setLastError(new Error(data?.message || 'You have opened this room in another tab. Session closed.'));
    };

    const onReconnectFailed = () => {
      setIsConnected(false);
      setConnectionStatus('disconnected');
    };

    socket.on(SOCKET_EVENTS.CONNECT, onConnect);
    socket.on(SOCKET_EVENTS.DISCONNECT, onDisconnect);
    socket.on(SOCKET_EVENTS.CONNECT_ERROR, onConnectError);
    socket.on('session_replaced', onSessionReplaced);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      socket.off(SOCKET_EVENTS.CONNECT, onConnect);
      socket.off(SOCKET_EVENTS.DISCONNECT, onDisconnect);
      socket.off(SOCKET_EVENTS.CONNECT_ERROR, onConnectError);
      socket.off('session_replaced', onSessionReplaced);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_failed', onReconnectFailed);
    };
  }, [socket]);

  const connect = () => {
    socket.connect();
  };

  const disconnect = () => {
    socket.disconnect();
  };

  const value = {
    socket,
    isConnected,
    connectionStatus,
    lastError,
    connect,
    disconnect,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

/**
 * Visual ConnectionStatus badge indicator that reflects real-time socket health.
 *
 * @param {Object} props
 * @param {string} [props.className='']
 * @param {'sm'|'md'} [props.size='md']
 */
export function ConnectionStatusIndicator({ className = '', size = 'md' }) {
  const { connectionStatus } = useSocket();

  /** @type {Record<import('./SocketContext.js').ConnectionStatus, { variant: 'success'|'warning'|'danger'|'info'|'neutral', label: string }>} */
  const config = {
    connected: { variant: 'success', label: 'Connected' },
    connecting: { variant: 'info', label: 'Connecting...' },
    reconnecting: { variant: 'warning', label: 'Reconnecting...' },
    disconnected: { variant: 'neutral', label: 'Disconnected' },
    error: { variant: 'danger', label: 'Offline' },
  };

  const current = config[connectionStatus] || config.disconnected;

  return (
    <Badge
      variant={current.variant}
      size={size}
      dot
      className={className}
      title={connectionStatus}
    >
      {current.label}
    </Badge>
  );
}

export default SocketProvider;
