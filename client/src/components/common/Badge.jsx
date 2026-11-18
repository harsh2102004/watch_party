import React from 'react';
import styles from './Badge.module.css';

/**
 * Reusable dark-themed Badge component for statuses and user roles.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Badge content.
 * @param {'primary'|'success'|'warning'|'danger'|'info'|'neutral'|'host'|'moderator'|'participant'|'viewer'} [props.variant='neutral']
 * @param {'sm'|'md'} [props.size='md']
 * @param {boolean} [props.dot=false] - Whether to render a colored status dot.
 * @param {string} [props.className='']
 */
export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  className = '',
  ...rest
}) {
  const normalizedVariant = typeof variant === 'string' ? variant.toLowerCase() : 'neutral';

  const badgeClasses = [
    styles.badge,
    styles[normalizedVariant] || styles.neutral,
    styles[size] || styles.md,
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={badgeClasses} {...rest}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}

export default Badge;
