import { createContext } from 'react';

/**
 * @typedef {Object} UserProfile
 * @property {string} userId
 * @property {string} email
 * @property {string} username
 */

/**
 * @typedef {Object} AuthContextValue
 * @property {UserProfile|null} user
 * @property {string|null} token
 * @property {boolean} isGuest
 * @property {string|null} guestName
 * @property {boolean} allowGuests
 * @property {boolean} isLoading
 * @property {(credentials: { email?: string, username?: string, password: string }) => Promise<void>} login
 * @property {(data: { email: string, username: string, password: string }) => Promise<void>} register
 * @property {(name?: string) => void} continueAsGuest
 * @property {() => void} logout
 */

export const AuthContext = createContext(/** @type {AuthContextValue|null} */ (null));
