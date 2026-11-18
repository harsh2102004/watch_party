/**
 * @file Login.jsx
 * @description Login page with input validation, server error alerts,
 * and a "Continue as guest" path when guest mode is active.
 */

import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Card, Input, Button } from '../components/index.js';
import { useAuth } from '../context/index.js';
import styles from './Login.module.css';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, continueAsGuest, allowGuests, isLoading } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine redirection destination (returns to the attempted room or default /)
  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      setError('Please enter your email or username.');
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        email: trimmedIdentifier.includes('@') ? trimmedIdentifier : undefined,
        username: !trimmedIdentifier.includes('@') ? trimmedIdentifier : undefined,
        password,
      });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGuestEntry = () => {
    continueAsGuest();
    navigate(from, { replace: true });
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.ambientGlow} />

      <div className={styles.authCard}>
        <div className={styles.header}>
          <span className={styles.brandBadge}>Watch Party</span>
          <h1 className={styles.title}>
            Welcome <span className={styles.titleGradient}>Back</span>
          </h1>
          <p className={styles.subtitle}>Sign in to sync videos, chat, and join watch rooms</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className={styles.form}>
            {error && <div className={styles.errorBanner}>{error}</div>}

            <Input
              label="Email or Username"
              type="text"
              placeholder="e.g. alice@example.com or alice_w"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={isSubmitting || isLoading}
              autoFocus
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting || isLoading}
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              disabled={isSubmitting || isLoading}
            >
              {isSubmitting ? 'Signing In...' : 'Sign In'}
            </Button>

            {allowGuests && (
              <>
                <div className={styles.guestDivider}>
                  <span>Or</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  fullWidth
                  onClick={handleGuestEntry}
                  disabled={isSubmitting || isLoading}
                >
                  Continue as Guest
                </Button>
              </>
            )}

            <div className={styles.footerLinks}>
              <span>
                Don't have an account?{' '}
                <Link to="/register" state={{ from: location.state?.from }} className={styles.link}>
                  Create an account
                </Link>
              </span>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
