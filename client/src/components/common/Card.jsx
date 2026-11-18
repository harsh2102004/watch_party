import React from 'react';
import styles from './Card.module.css';

/**
 * Reusable dark-themed Card container component with header, body, and footer slots.
 *
 * @param {Object} props
 * @param {React.ReactNode} [props.title] - Card header title.
 * @param {React.ReactNode} [props.subtitle] - Card header secondary text.
 * @param {React.ReactNode} [props.headerAction] - Action component on the right of header.
 * @param {React.ReactNode} props.children - Main card body contents.
 * @param {React.ReactNode} [props.footer] - Optional card footer contents.
 * @param {'default'|'elevated'|'bordered'|'interactive'} [props.variant='default']
 * @param {boolean} [props.noPadding=false] - If true, body has 0 padding (for media/video embeds).
 * @param {string} [props.className='']
 * @param {Function} [props.onClick]
 */
export function Card({
  title,
  subtitle,
  headerAction,
  children,
  footer,
  variant = 'default',
  noPadding = false,
  className = '',
  onClick,
  ...rest
}) {
  const cardClasses = [
    styles.card,
    styles[variant] || styles.default,
    onClick || variant === 'interactive' ? styles.interactive : '',
    className,
  ].filter(Boolean).join(' ');

  const hasHeader = Boolean(title || subtitle || headerAction);

  return (
    <div className={cardClasses} onClick={onClick} {...rest}>
      {hasHeader && (
        <div className={styles.header}>
          <div className={styles.headerText}>
            {title && <h3 className={styles.title}>{title}</h3>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {headerAction && <div className={styles.headerAction}>{headerAction}</div>}
        </div>
      )}

      <div className={`${styles.body} ${noPadding ? styles.noPadding : ''}`}>
        {children}
      </div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

export default Card;
