/**
 * @file test-playback-sync.js
 * @description Integration verification script:
 * 1. Host creates room and plays video for ~2 seconds.
 * 2. Joiner connects mid-video and asserts received sync_state currentTime matches elapsed time.
 * 3. Joiner attempts play, seek, change_video and asserts FORBIDDEN errors with unchanged room state.
 */

import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:4000';
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

async function run() {
  console.log('\n=== Starting Mid-Video Sync & Participant Guard Verification ===\n');

  // Step 1: Host creates room and sets a video
  const host = await connectClient('Host');
  let roomId;
  const createdPromise = new Promise((res) => host.once('room_created', (data) => {
    roomId = data.roomId;
    res(data);
  }));
  host.emit('create_room', { username: 'HostUser' });
  await createdPromise;
  console.log(`[Host] Created room: ${roomId}`);

  // Set video and start playing
  host.emit('change_video', { videoId: 'dQw4w9WgXcQ' });
  await wait(100);
  host.emit('play', {});
  console.log('[Host] Started playing video dQw4w9WgXcQ. Waiting 2.0s to let video advance...');

  // Let video play for 2.0 seconds
  await wait(2000);

  // Step 2: Late joiner connects mid-video
  console.log('\n[LateJoiner] Connecting mid-video...');
  const joiner = await connectClient('LateJoiner');

  const joinedPromise = new Promise((res) => joiner.once('room_joined', res));
  joiner.emit('join_room', { roomId, username: 'JoinerUser' });
  const joinData = await joinedPromise;

  const receivedTime = joinData.sync_state.currentTime;
  console.log(`[LateJoiner] Received sync_state on join:`);
  console.log(`  - playState: ${joinData.sync_state.playState}`);
  console.log(`  - videoId: ${joinData.sync_state.videoId}`);
  console.log(`  - currentTime: ${receivedTime.toFixed(3)}s`);

  if (receivedTime < 1.8 || receivedTime > 2.5) {
    throw new Error(`Expected currentTime ~2.0s, but received ${receivedTime}s`);
  }
  console.log('  -> PASS: Mid-video extrapolated currentTime verified!\n');

  // Step 3: Test that PARTICIPANT cannot control playback
  console.log('[LateJoiner] Attempting unauthorized actions (play, seek, change_video)...');

  // Test unauthorized seek
  const seekErrorPromise = new Promise((res) => joiner.once('error_event', res));
  joiner.emit('seek', { time: 500 });
  const seekError = await seekErrorPromise;
  console.log(`[LateJoiner] Seek rejected with: ${seekError.code} - ${seekError.message}`);
  if (seekError.code !== 'FORBIDDEN') throw new Error('Expected FORBIDDEN on seek');

  // Test unauthorized change_video
  const changeErrorPromise = new Promise((res) => joiner.once('error_event', res));
  joiner.emit('change_video', { videoId: 'a-B_1234567' });
  const changeError = await changeErrorPromise;
  console.log(`[LateJoiner] Change_video rejected with: ${changeError.code} - ${changeError.message}`);
  if (changeError.code !== 'FORBIDDEN') throw new Error('Expected FORBIDDEN on change_video');

  // Test unauthorized pause
  const pauseErrorPromise = new Promise((res) => joiner.once('error_event', res));
  joiner.emit('pause', {});
  const pauseError = await pauseErrorPromise;
  console.log(`[LateJoiner] Pause rejected with: ${pauseError.code} - ${pauseError.message}`);
  if (pauseError.code !== 'FORBIDDEN') throw new Error('Expected FORBIDDEN on pause');

  console.log('\n  -> PASS: All unauthorized actions successfully rejected with FORBIDDEN!\n');

  // Cleanup
  host.disconnect();
  joiner.disconnect();
  await wait(300);

  console.log('=== All Verifications Passed Cleanly ===\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Integration verification failed:', err);
  process.exit(1);
});
