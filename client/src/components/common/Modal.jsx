import React, { useEffect, useCallback } from 'react';
import styles from './Modal.module.css';

/**
 * Reusable dark-themed Modal Dialog component.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Controls modal visibility.
 * @param {() => void} [props.onClose] - Callback when modal is requested to close.
 * @param {string} props.title - Modal title.
 * @param {string} [props.subtitle] - Optional subtitle description.
 * @param {React.ReactNode} props.children - Modal content.
 * @param {React.ReactNode} [props.footer] - Modal action buttons footer.
 * @param {boolean} [props.closeOnBackdrop=true] - Whether clicking backdrop triggers onClose.
 * @param {boolean} [props.closeOnEscape=true] - Whether pressing Escape triggers onClose.
 * @param {boolean} [props.showCloseButton=true] - Whether to show the top-right X button.
 * @param {string} [props.className=''] - Additional custom CSS class.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  className = '',
}) {
  const handleKeyDown = useCallback(
    (e) => {
      if (closeOnEscape && e.key === 'Escape' && onClose) {
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && closeOnBackdrop && onClose) {
      onClose();
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`${styles.modal} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <h2 id="modal-title" className={styles.title}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {showCloseButton && onClose && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close dialog"
            >
              &times;
            </button>
          )}
        </div>

        <div className={styles.body}>{children}</div>

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

export default Modal;
