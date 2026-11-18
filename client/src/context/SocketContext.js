import { createContext } from 'react';

/**
 * @typedef {'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'error'} ConnectionStatus
 *
 * @typedef {Object} SocketContextValue
 * @property {import('socket.io-client').Socket|null} socket - The shared Socket.IO client instance.
 * @property {boolean} isConnected - True when the socket is actively connected.
 * @property {ConnectionStatus} connectionStatus - Granular status string.
 * @property {Error|null} lastError - Most recent connection error if any.
 * @property {() => void} connect - Manually trigger connection.
 * @property {() => void} disconnect - Manually trigger disconnection.
 */

export const SocketContext = createContext(/** @type {SocketContextValue|null} */ (null));
export default SocketContext;
