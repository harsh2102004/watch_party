import React, { useState, useEffect } from 'react';
import { Badge, Button, Input, Modal } from './common/index.js';
import { useRoom } from '../context/index.js';
import { Role } from '../utils/constants.js';
import { formatTime } from '../utils/youtube.js';
import styles from './ApprovalPanel.module.css';

/**
 * ApprovalPanel Component.
 *
 * Exclusively visible to HOST and MODERATOR roles.
 * Displays all active pending action requests submitted by participants/viewers, including:
 * 1. Requester identity (username, avatar).
 * 2. Action type badge (Play, Pause, Seek, Change Video).
 * 3. Specific payload details (target timestamp, YouTube videoId).
 * 4. Dynamic countdown of time remaining before the server 60-second sweeper expires the request.
 * 5. Approve button emitting approve_request and Reject button opening a reason dialog emitting reject_request.
 * 6. Automatically removes resolved items in real time via request_resolved event handling in RoomProvider.
 *
 * @param {Object} props
 * @param {string} [props.className=''] - Custom wrapper CSS class.
 */
export function ApprovalPanel({ className = '' }) {
  const {
    me,
    pendingRequests = [],
    approveRequest,
    rejectRequest,
  } = useRoom();

  const isModerator = me?.role === Role.HOST || me?.role === Role.MODERATOR;

  // Real-time 1-second tick to update countdown timer
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Reject Confirmation Dialog State
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('Declined by moderator');

  if (!isModerator) {
    return null;
  }

  const handleOpenRejectModal = (req) => {
    setRejectTarget(req);
    setRejectReason('Declined by moderator');
  };

  const handleConfirmReject = () => {
    if (!rejectTarget) return;
    const reqId = rejectTarget.id || rejectTarget.requestId;
    rejectRequest(reqId, rejectReason.trim() || undefined);
    setRejectTarget(null);
    setRejectReason('Declined by moderator');
  };

  const handleApprove = (req) => {
    const reqId = req.id || req.requestId;
    approveRequest(reqId);
  };

  /**
   * Returns human-readable payload string based on action type.
   */
  const renderPayloadDetails = (req) => {
    switch (req.type) {
      case 'seek': {
        const timeSec = req.payload?.time ?? 0;
        return (
          <span className={styles.payloadSummary}>
            Target: <span className={styles.payloadValue}>{formatTime(timeSec)}</span> ({Math.round(timeSec)}s)
          </span>
        );
      }
      case 'change_video': {
        const videoId = req.payload?.videoId || 'Unknown';
        return (
          <span className={styles.payloadSummary}>
            Video ID: <span className={styles.payloadValue}>{videoId}</span>
          </span>
        );
      }
      case 'play':
        return (
          <span className={styles.payloadSummary}>
            Action: <span className={styles.payloadValue}>Resume Playback</span>
          </span>
        );
      case 'pause':
        return (
          <span className={styles.payloadSummary}>
            Action: <span className={styles.payloadValue}>Pause Playback</span>
          </span>
        );
      default:
        return (
          <span className={styles.payloadSummary}>
            Payload: <span className={styles.payloadValue}>{JSON.stringify(req.payload || {})}</span>
          </span>
        );
    }
  };

  /**
   * Action badge variant mapper.
   */
  const getActionBadgeVariant = (type) => {
    switch (type) {
      case 'play':
        return 'success';
      case 'pause':
        return 'warning';
      case 'seek':
        return 'info';
      case 'change_video':
        return 'primary';
      default:
        return 'neutral';
    }
  };

  return (
    <div className={`${styles.panelContainer} ${className}`}>
      {/* Header with Title and Pending Badge Count */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h4 className={styles.title}>
            <span>Pending Approvals</span>
          </h4>
          <Badge
            variant={pendingRequests.length > 0 ? 'warning' : 'neutral'}
            size="sm"
          >
            {pendingRequests.length}
          </Badge>
        </div>
        <span className={styles.subtitle}>Host & Moderator Review</span>
      </div>

      {/* Requests List */}
      {pendingRequests.length === 0 ? (
        <div className={styles.emptyState}>
          No pending action requests to review.
        </div>
      ) : (
        <div className={styles.requestsList}>
          {pendingRequests.map((req) => {
            const reqId = req.id || req.requestId;
            const requesterInitial = (req.requesterName || '?').charAt(0).toUpperCase();

            // Calculate remaining seconds out of 60s window
            const createdAt = req.createdAt || now;
            const remainingSeconds = Math.max(0, Math.ceil((createdAt + 60000 - now) / 1000));
            const isUrgent = remainingSeconds <= 15;

            return (
              <div key={reqId} className={styles.requestCard}>
                {/* Top Row: Requester Info, Action Badge, Time Remaining */}
                <div className={styles.requestTopRow}>
                  <div className={styles.requesterInfo}>
                    <div className={styles.requesterAvatar}>{requesterInitial}</div>
                    <span className={styles.requesterName} title={req.requesterName}>
                      {req.requesterName}
                    </span>
                    <Badge variant={getActionBadgeVariant(req.type)} size="sm">
                      {req.type.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>

                  <span
                    className={`${styles.timeRemainingBadge} ${isUrgent ? styles.timeUrgent : styles.timeNormal}`}
                    title="Time remaining before request expires automatically"
                  >
                    {remainingSeconds}s left
                  </span>
                </div>

                {/* Details Row: Target/Payload Information */}
                <div className={styles.requestDetailsRow}>
                  {renderPayloadDetails(req)}

                  {/* Actions: Approve & Reject */}
                  <div className={styles.actionButtons}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleApprove(req)}
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenRejectModal(req)}
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', color: '#fca5a5' }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Confirmation Dialog */}
      <Modal
        isOpen={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title="Reject Action Request"
        subtitle={`Decline ${rejectTarget?.type?.replace('_', ' ') || 'action'} from ${rejectTarget?.requesterName || 'participant'}`}
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setRejectTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleConfirmReject}
            >
              Confirm Reject
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <p>
            Please provide a rejection reason. This will be sent directly to <strong>{rejectTarget?.requesterName}</strong>:
          </p>
          <Input
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Inappropriate timing, please finish current song"
            maxLength={100}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}

export default ApprovalPanel;
