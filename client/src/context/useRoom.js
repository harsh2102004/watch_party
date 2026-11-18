import { useContext } from 'react';
import { RoomContext } from './RoomContext.js';

/**
 * Custom hook to consume room state and dispatch room socket actions.
 *
 * @returns {import('./RoomContext.js').RoomContextValue}
 * @throws {Error} If called outside of a RoomProvider.
 */
export function useRoom() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a <RoomProvider>');
  }
  return context;
}

export default useRoom;
