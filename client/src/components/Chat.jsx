import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Badge } from './common/index.js';
import { useRoom } from '../context/index.js';
import { VALIDATION } from '../utils/constants.js';
import styles from './Chat.module.css';

/**
 * Formats a UNIX timestamp (ms) to a concise HH:MM time string.
 *
 * @param {number|string} timestamp
 * @returns {string} e.g. "14:05"
 */
function formatChatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Chat Component.
 *
 * Real-time room chat component featuring:
 * 1. Scrollable message list with automatic scroll-to-bottom on new messages.
 * 2. Input box with Enter key to send (Shift+Enter for newline if multiline, but single line Enter emits send).
 * 3. Dynamic character counter (max 300 characters) with warning & error threshold styling.
 * 4. Color-coded role badges next to usernames (Host, Moderator, Participant, Viewer).
 * 5. Distinct system notifications for member join/leave events.
 * 6. Completely safe text rendering without dangerouslySetInnerHTML to prevent XSS.
 *
 * @param {Object} props
 * @param {string} [props.className=''] - Custom wrapper CSS class.
 */
export function Chat({ className = '' }) {
  const { chat = [], me, sendChatMessage } = useRoom();
  const [inputText, setInputText] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const messageListRef = useRef(null);
  const inputRef = useRef(null);

  const maxChars = VALIDATION.CHAT_MAX_LENGTH || 300;
  const currentLength = inputText.length;
  const remainingChars = maxChars - currentLength;
  const isOverLimit = currentLength > maxChars;
  const canSend = inputText.trim().length > 0 && !isOverLimit;

  // Auto-scroll to bottom whenever a new chat message arrives
  useLayoutEffect(() => {
    const listEl = messageListRef.current;
    if (listEl) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  }, [chat]);

  // Keep focus on input after initial render
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSendMessage = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isOverLimit) return;

    sendChatMessage(trimmed);
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleSendMessage();
  };

  const cardClass = [
    styles.chatCard,
    isMinimized ? styles.chatCardMinimized : '',
    isMaximized ? styles.chatCardMaximized : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      {/* Header bar with Minimize & Maximize Actions */}
      <div className={styles.chatHeader}>
        <div className={styles.chatTitle}>
          <span>💬 Room Chat</span>
          <span className={styles.chatCountBadge}>{chat.length}</span>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => {
              if (isMinimized) setIsMinimized(false);
              setIsMaximized(!isMaximized);
            }}
            title={isMaximized ? 'Restore normal height' : 'Maximize chat'}
            aria-label={isMaximized ? 'Restore normal height' : 'Maximize chat'}
          >
            {isMaximized ? '🗗' : '🗖'}
          </button>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => {
              if (isMaximized) setIsMaximized(false);
              setIsMinimized(!isMinimized);
            }}
            title={isMinimized ? 'Expand chat' : 'Minimize chat'}
            aria-label={isMinimized ? 'Expand chat' : 'Minimize chat'}
          >
            {isMinimized ? '+' : '−'}
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Scrollable message list */}
          <div
            ref={messageListRef}
            className={styles.messageList}
            role="log"
            aria-live="polite"
            aria-label="Room chat messages"
          >
        {chat.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">&#128172;</span>
            <p>No messages yet.</p>
            <p>Say hello to the watch party!</p>
          </div>
        ) : (
          chat.map((msg) => {
            // Render system events (e.g. user joined or left)
            if (msg.isSystem) {
              return (
                <div key={msg.id} className={styles.systemMessage}>
                  <span
                    className={styles.systemIcon}
                    aria-hidden="true"
                    // HTML entity string rendered via JSX children (plain text)
                  >
                    {msg.systemType === 'join' ? '\u2192' : '\u2190'}
                  </span>
                  <span>{msg.text}</span>
                  {msg.timestamp && (
                    <span className={styles.timestamp}>
                      {formatChatTime(msg.timestamp)}
                    </span>
                  )}
                </div>
              );
            }

            // Normal user message
            const isMe = Boolean(me && me.userId && msg.userId === me.userId);
            const role = msg.role ? String(msg.role).toUpperCase() : 'PARTICIPANT';

            return (
              <div
                key={msg.id}
                className={`${styles.messageItem} ${isMe ? styles.messageItemOwn : ''}`}
              >
                <div className={styles.messageMeta}>
                  <span
                    className={`${styles.senderName} ${isMe ? styles.senderNameOwn : ''}`}
                  >
                    {msg.username || 'Anonymous'}
                    {isMe ? ' (You)' : ''}
                  </span>

                  {/* Role badge next to username */}
                  <Badge variant={role.toLowerCase()} size="sm">
                    {role}
                  </Badge>

                  {/* Message timestamp */}
                  {msg.timestamp && (
                    <span className={styles.timestamp}>
                      {formatChatTime(msg.timestamp)}
                    </span>
                  )}
                </div>

                {/* Safe plain text rendering (No dangerouslySetInnerHTML) */}
                <div
                  className={`${styles.messageText} ${isMe ? styles.messageTextOwn : ''}`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input section with Enter to send and character counter */}
      <form onSubmit={handleFormSubmit} className={styles.inputForm}>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            type="text"
            className={styles.inputField}
            placeholder="Type a message... (Press Enter to send)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={maxChars + 50} // Allow slight typing so counter visibly alerts user before trim
            aria-label="Chat message input"
          />

          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!canSend}
            title={canSend ? 'Send message' : 'Type a message to send'}
          >
            <span>Send</span>
            <span aria-hidden="true">&#10148;</span>
          </button>
        </div>

        <div className={styles.inputFooter}>
          <span className={styles.hintText}>Press Enter to send</span>
          <span
            className={`${styles.charCounter} ${
              isOverLimit
                ? styles.charError
                : remainingChars <= 30
                  ? styles.charWarning
                  : ''
            }`}
          >
            {currentLength} / {maxChars}
          </span>
        </div>
      </form>
        </>
      )}
    </div>
  );
}

export default Chat;
