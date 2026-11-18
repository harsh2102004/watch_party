/**
 * @file UserNav.jsx
 * @description Displays the authenticated user's name badge and Logout button in headers.
 */

import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/index.js';
import styles from './UserNav.module.css';

export function UserNav() {
  const { user, isGuest, guestName, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (user) {
    return (
      <div className={styles.navContainer}>
        <div className={styles.userBadge}>
          <span className={styles.userIcon}>👤</span>
          <span>{user.username}</span>
        </div>
        <button type="button" onClick={handleLogout} className={styles.logoutBtn} title="Sign out">
          Logout
        </button>
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className={styles.navContainer}>
        <div className={styles.userBadge}>
          <span className={styles.userIcon}>👤</span>
          <span>Guest{guestName ? `: ${guestName}` : ''}</span>
        </div>
        <Link to="/login" className={styles.loginLink}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.navContainer}>
      <Link to="/login" className={styles.loginLink}>
        Sign in
      </Link>
    </div>
  );
}
