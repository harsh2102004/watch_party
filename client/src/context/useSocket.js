import { useContext } from 'react';
import { SocketContext } from './SocketContext.js';

/**
 * Custom hook to consume the singleton Socket.IO connection and status.
 *
 * @returns {import('./SocketContext.js').SocketContextValue}
 * @throws {Error} If called outside of a SocketProvider.
 */
export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a <SocketProvider>');
  }
  return context;
}

export default useSocket;
