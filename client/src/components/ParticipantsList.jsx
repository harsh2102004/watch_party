import React, { useState, useEffect } from 'react';
import { Badge, Button, Input, Modal } from './common/index.js';
import { useRoom } from '../context/index.js';
import { Role } from '../utils/constants.js';
import styles from './ParticipantsList.module.css';

/**
 * ParticipantsList Component.
 *
 * Displays all active room members with color-coded role badges and a "(you)" indicator.
 * For the HOST, provides an administrative dropdown menu per participant with options to:
 * 1. Change roles (Make Moderator, Make Participant, Make Viewer).
 * 2. Transfer host authority (with confirmation dialog).
 * 3. Remove/kick participant (with confirmation dialog and optional reason).
 *
 * @param {Object} props
 * @param {string} [props.className=''] - Custom wrapper CSS class.
 */
export function ParticipantsList({ className = '' }) {
  const {
    me,
    participants = [],
    assignRole,
    removeParticipant,
    transferHost,
  } = useRoom();

  const isHost = me?.role === Role.HOST;

  // Active dropdown menu state (userId of the participant whose menu is open)
  const [openMenuUserId, setOpenMenuUserId] = useState(null);

  // Dialog States
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');

  const [transferTarget, setTransferTarget] = useState(null);

  // Close open dropdown on outside click
  useEffect(() => {
    if (!openMenuUserId) return;

    const handleOutsideClick = (e) => {
      if (!e.target.closest(`.${styles.menuWrapper}`)) {
        setOpenMenuUserId(null);
      }
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [openMenuUserId]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleToggleMenu = (userId, e) => {
    e.stopPropagation();
    setOpenMenuUserId((prev) => (prev === userId ? null : userId));
  };

  const handleAssignRole = (userId, role) => {
    assignRole(userId, role);
    setOpenMenuUserId(null);
  };

  const handleOpenRemoveModal = (participant) => {
    setRemoveTarget(participant);
    setRemoveReason('');
    setOpenMenuUserId(null);
  };

  const handleConfirmRemove = () => {
    if (!removeTarget) return;
    removeParticipant(removeTarget.userId, removeReason.trim() || undefined);
    setRemoveTarget(null);
    setRemoveReason('');
  };

  const handleOpenTransferModal = (participant) => {
    setTransferTarget(participant);
    setOpenMenuUserId(null);
  };

  const handleConfirmTransfer = () => {
    if (!transferTarget) return;
    transferHost(transferTarget.userId);
    setTransferTarget(null);
  };

  return (
    <div className={`${styles.container} ${className}`}>
      {/* Header */}
      <div className={styles.header}>
        <span>Participants</span>
        <Badge variant="neutral" size="sm">
          {participants.length}
        </Badge>
      </div>

      {/* Participants List */}
      <div className={styles.list}>
        {participants.map((p) => {
          const isCurrentUser = p.userId === me?.userId;
          const isMenuOpen = openMenuUserId === p.userId;
          const initial = (p.username || '?').charAt(0).toUpperCase();

          return (
            <div
              key={p.userId}
              className={`${styles.participantItem} ${isCurrentUser ? styles.isCurrentUser : ''}`}
            >
              <div className={styles.left}>
                <div className={styles.avatar}>{initial}</div>
                <span className={styles.username} title={p.username}>
                  {p.username}
                </span>
                {isCurrentUser && (
                  <span className={styles.youBadge}>YOU</span>
                )}
              </div>

              <div className={styles.right}>
                <Badge
                  variant={p.role ? p.role.toLowerCase() : 'viewer'}
                  size="sm"
                >
                  {p.role || 'VIEWER'}
                </Badge>

                {/* Host Actions Menu (available on all participants except host themselves) */}
                {isHost && !isCurrentUser && (
                  <div className={styles.menuWrapper}>
                    <button
                      type="button"
                      className={`${styles.menuTrigger} ${isMenuOpen ? styles.menuTriggerActive : ''}`}
                      onClick={(e) => handleToggleMenu(p.userId, e)}
                      aria-label={`Manage ${p.username}`}
                      aria-expanded={isMenuOpen}
                    >
                      &#8226;&#8226;&#8226;
                    </button>

                    {isMenuOpen && (
                      <div className={styles.dropdownMenu}>
                        {p.role !== Role.MODERATOR && (
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => handleAssignRole(p.userId, Role.MODERATOR)}
                          >
                            Make Moderator
                          </button>
                        )}
                        {p.role !== Role.PARTICIPANT && (
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => handleAssignRole(p.userId, Role.PARTICIPANT)}
                          >
                            Make Participant
                          </button>
                        )}
                        {p.role !== Role.VIEWER && (
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => handleAssignRole(p.userId, Role.VIEWER)}
                          >
                            Make Viewer
                          </button>
                        )}

                        <div className={styles.menuDivider} />

                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => handleOpenTransferModal(p)}
                        >
                          Transfer Host
                        </button>
                        <button
                          type="button"
                          className={`${styles.menuItem} ${styles.menuItemDanger}`}
                          onClick={() => handleOpenRemoveModal(p)}
                        >
                          Remove from Room
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* 1. Remove Participant Confirmation Dialog */}
      {/* -------------------------------------------------------------------- */}
      <Modal
        isOpen={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Remove Participant"
        subtitle={`Disconnect ${removeTarget?.username || 'user'} from this watch party.`}
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setRemoveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleConfirmRemove}
            >
              Remove Participant
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.modalDangerWarning}>
            Are you sure you want to remove <span className={styles.targetHighlight}>{removeTarget?.username}</span>? They will be immediately disconnected from the room.
          </div>
          <Input
            label="Reason for Removal (optional)"
            placeholder="e.g. Disruptive behavior, inactive"
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
            maxLength={100}
            autoFocus
          />
        </div>
      </Modal>

      {/* -------------------------------------------------------------------- */}
      {/* 2. Transfer Host Confirmation Dialog */}
      {/* -------------------------------------------------------------------- */}
      <Modal
        isOpen={Boolean(transferTarget)}
        onClose={() => setTransferTarget(null)}
        title="Transfer Host Authority"
        subtitle="Irreversible ownership transfer"
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setTransferTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleConfirmTransfer}
            >
              Confirm Transfer
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.modalWarning}>
            Warning: Transferring room ownership cannot be undone by yourself.
          </div>
          <p>
            You are about to transfer Host authority to <span className={styles.targetHighlight}>{transferTarget?.username}</span>.
          </p>
          <p>
            You will step down to <strong>MODERATOR</strong> role, and <span className={styles.targetHighlight}>{transferTarget?.username}</span> will become the new Host with exclusive rights to manage roles, kick members, and transfer ownership.
          </p>
        </div>
      </Modal>
    </div>
  );
}

export default ParticipantsList;
