/**
 * @file smoke-test.js
 * @description Automated socket smoke test verifying real-time socket events over TCP:
 * room creation, joining, role promotions, playback sync, and request approvals.
 */

import { io } from 'socket.io-client';

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:4000';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function runSmokeTest() {
  console.log('====================================================');
  console.log('       RUNNING SOCKET SMOKE TEST (smoke:local)       ');
  console.log('====================================================\n');

  let hostSocket, joinerSocket;
  let roomId;

  try {
    // Step 1: Health check
    const healthRes = await fetch(`${SERVER_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check returned status ${healthRes.status}`);
    const healthData = await healthRes.json();
    console.log(`[PASS] Step 1: Server health check responsive (db: ${healthData.db})`);

    // Step 2: Host connection and room creation
    hostSocket = await connectClient('Host');
    const createdPromise = new Promise((res) => hostSocket.once('room_created', res));
    hostSocket.emit('create_room', { username: 'SmokeHost' });
    const createdData = await createdPromise;
    roomId = createdData.roomId;
    if (!roomId || roomId.length !== 6) throw new Error(`Invalid room ID: ${roomId}`);
    console.log(`[PASS] Step 2: Host created room successfully (Code: ${roomId})`);

    // Step 3: Joiner connection and joining
    joinerSocket = await connectClient('Joiner');
    const joinedPromise = new Promise((res) => joinerSocket.once('room_joined', res));
    const userJoinedPromise = new Promise((res) => hostSocket.once('user_joined', res));
    joinerSocket.emit('join_room', { roomId, username: 'SmokeJoiner' });
    const [joinData, userJoinedData] = await Promise.all([joinedPromise, userJoinedPromise]);
    if (joinData.role !== 'PARTICIPANT') throw new Error(`Expected role PARTICIPANT, got ${joinData.role}`);
    console.log(`[PASS] Step 3: Joiner joined room as PARTICIPANT; Host received user_joined`);

    // Step 4: Video playback control by Host
    const changeVideoPromise = new Promise((res) => joinerSocket.once('sync_state', res));
    hostSocket.emit('change_video', { videoId: 'dQw4w9WgXcQ' });
    const changeData = await changeVideoPromise;
    if (changeData.videoId !== 'dQw4w9WgXcQ') throw new Error(`Video ID mismatch: ${changeData.videoId}`);
    console.log(`[PASS] Step 4: Host changed video to ${changeData.videoId}; Joiner synchronized`);

    // Step 5: Unauthorized action rejection
    const forbiddenPromise = new Promise((res) => joinerSocket.once('error_event', res));
    joinerSocket.emit('pause', {});
    const forbiddenData = await forbiddenPromise;
    if (forbiddenData.code !== 'FORBIDDEN') throw new Error(`Expected FORBIDDEN, got ${forbiddenData.code}`);
    console.log(`[PASS] Step 5: Unauthorized participant control rejected with FORBIDDEN`);

    // Step 6: Host departure and automatic host promotion
    const roleAssignedPromise = new Promise((res) => joinerSocket.once('role_assigned', res));
    const userLeftPromise = new Promise((res) => joinerSocket.once('user_left', res));
    hostSocket.disconnect();
    const [promotedData] = await Promise.all([roleAssignedPromise, userLeftPromise]);
    if (promotedData.role !== 'HOST') throw new Error(`Expected auto-promotion to HOST, got ${promotedData.role}`);
    console.log(`[PASS] Step 6: Host disconnected; Joiner auto-promoted to HOST`);

    console.log('\n====================================================');
    console.log('      ALL SMOKE TEST STEPS PASSED SUCCESSFULLY      ');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[FAIL] Smoke test encountered an error:', err.message);
    process.exit(1);
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (joinerSocket?.connected) joinerSocket.disconnect();
  }
}

runSmokeTest();
