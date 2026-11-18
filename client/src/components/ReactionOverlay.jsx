import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket, useRoom } from '../context/index.js';
import { SOCKET_EVENTS, ALLOWED_REACTIONS } from '../utils/constants.js';
import styles from './ReactionOverlay.module.css';

/**
 * ReactionOverlay Component.
 *
 * Renders two interconnected features:
 * 1. An absolute overlay directly layered over the YouTube player viewport that renders
 *    animated floating emojis rising upwards and fading out over 2.6 seconds.
 * 2. An ergonomic reaction bar with the 6 whitelisted emojis ('❤️', '🔥', '😂', '🎉', '😮', '👏')
 *    allowing instant one-click broadcasting to all room members.
 *
 * @param {Object} props
 * @param {boolean} [props.showBar=true] - Whether to render the reaction bar buttons.
 * @param {string} [props.className=''] - Custom CSS class for reaction bar wrapper.
 */
export function ReactionOverlay({ showBar = true, className = '' }) {
  const { socket } = useSocket();
  const { sendReaction } = useRoom();
  const [activeReactions, setActiveReactions] = useState([]);
  const reactionIdRef = useRef(0);

  // Listen for broadcasted reaction events from socket
  useEffect(() => {
    if (!socket) return;

    const handleReaction = (data) => {
      if (!data || !data.emoji) return;

      const id = ++reactionIdRef.current;
      // Randomize horizontal spawn position between 10% and 90%
      const leftPercent = Math.floor(Math.random() * 80) + 10;
      // Slight random rotation angle between -20deg and +20deg
      const rotationDeg = Math.floor(Math.random() * 40) - 20;

      const newReaction = {
        id,
        emoji: data.emoji,
        username: data.username || '',
        leftPercent,
        rotationDeg,
      };

      setActiveReactions((prev) => [...prev, newReaction]);

      // Automatically prune after CSS animation completion (2600ms + buffer)
      setTimeout(() => {
        setActiveReactions((prev) => prev.filter((r) => r.id !== id));
      }, 2700);
    };

    socket.on(SOCKET_EVENTS.REACTION, handleReaction);
    return () => {
      socket.off(SOCKET_EVENTS.REACTION, handleReaction);
    };
  }, [socket]);

  const handleEmojiClick = useCallback(
    (emoji) => {
      sendReaction(emoji);
    },
    [sendReaction]
  );

  return (
    <>
      {/* 1. Floating Animation Overlay (Rendered directly in player viewport) */}
      <div
        className={styles.overlayContainer}
        aria-hidden="true"
        role="presentation"
      >
        {activeReactions.map((item) => (
          <div
            key={item.id}
            className={styles.floatingEmoji}
            style={{
              left: `${item.leftPercent}%`,
              '--rotation': `${item.rotationDeg}deg`,
            }}
          >
            <span>{item.emoji}</span>
            {item.username && (
              <span className={styles.emojiSender}>{item.username}</span>
            )}
          </div>
        ))}
      </div>

      {/* 2. Reaction Bar Toolbar */}
      {showBar && (
        <div
          className={`${styles.reactionBar} ${className}`}
          role="toolbar"
          aria-label="Reaction bar"
        >
          <span className={styles.reactionBarLabel}>React:</span>
          {ALLOWED_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.reactionButton}
              onClick={() => handleEmojiClick(emoji)}
              aria-label={`Send ${emoji} reaction`}
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default ReactionOverlay;
