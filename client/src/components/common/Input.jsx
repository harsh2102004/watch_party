import React, { useId } from 'react';
import styles from './Input.module.css';

/**
 * Reusable dark-themed Input component with label, icon, and error validation states.
 *
 * @param {Object} props
 * @param {string} [props.label] - Field label text.
 * @param {string} [props.error] - Validation error message.
 * @param {string} [props.helperText] - Supplementary hint text.
 * @param {React.ReactNode} [props.leftIcon] - Icon to display on the left.
 * @param {string} [props.className=''] - Custom wrapper class.
 * @param {string} [props.id] - Element ID.
 */
export function Input({
  label,
  error,
  helperText,
  leftIcon,
  className = '',
  id,
  disabled = false,
  ...rest
}) {
  const generatedId = useId();
  const inputId = id || generatedId;

  const wrapperClasses = [
    styles.wrapper,
    error ? styles.hasError : '',
    className,
  ].filter(Boolean).join(' ');

  const inputClasses = [
    styles.input,
    leftIcon ? styles.hasLeftIcon : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClasses}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}

      <div className={styles.inputContainer}>
        {leftIcon && <span className={styles.leftIcon}>{leftIcon}</span>}
        <input
          id={inputId}
          className={inputClasses}
          disabled={disabled}
          {...rest}
        />
      </div>

      {error ? (
        <span className={styles.errorText} role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span className={styles.helperText}>{helperText}</span>
      ) : null}
    </div>
  );
}

export default Input;
