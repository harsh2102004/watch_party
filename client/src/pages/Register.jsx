/**
 * @file Register.jsx
 * @description Registration page with client-side validation, server error alerts,
 * and seamless redirection upon account creation.
 */

import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Card, Input, Button } from '../components/index.js';
import { useAuth } from '../context/index.js';
import styles from './Login.module.css';

export function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const { register, continueAsGuest, allowGuests, isLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // 1. Email validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email address is required.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please provide a valid email address.');
      return;
    }

    // 2. Username validation
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      setError('Username must be between 3 and 20 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      setError('Username may only contain letters, numbers, underscores, and hyphens.');
      return;
    }

    // 3. Password validation
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        email: trimmedEmail,
        username: trimmedUsername,
        password,
      });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
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
            Create an <span className={styles.titleGradient}>Account</span>
          </h1>
          <p className={styles.subtitle}>Join watch parties, chat, and keep your host privileges</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className={styles.form}>
            {error && <div className={styles.errorBanner}>{error}</div>}

            <Input
              label="Email Address"
              type="email"
              placeholder="alice@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting || isLoading}
              autoFocus
            />

            <Input
              label="Username"
              type="text"
              placeholder="3-20 chars (e.g. alice_w)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting || isLoading}
            />

            <Input
              label="Password"
              type="password"
              placeholder="Min 8 characters"
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
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
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
                Already have an account?{' '}
                <Link to="/login" state={{ from: location.state?.from }} className={styles.link}>
                  Sign in
                </Link>
              </span>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
