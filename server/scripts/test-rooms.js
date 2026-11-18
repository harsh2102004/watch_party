/**
 * @file test-rooms.js
 * @description Integration test for watch-party rooms: creates room with Alice,
 * joins with Bob, logs all events, disconnects Alice to verify Bob's auto-promotion.
 */

import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:4000';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatLog = (prefix, event, data) => {
  if (data !== undefined) {
    console.log(`[${prefix}] received "${event}":`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${prefix}] ${event}`);
  }
};

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false
    });

    const events = [
      'room_created',
      'room_joined',
      'user_joined',
      'user_left',
      'role_assigned',
      'error_event'
    ];

    socket.on('connect', () => {
      formatLog(name, `connected with socketId: ${socket.id}`);
      resolve(socket);
    });

    socket.on('disconnect', () => {
      formatLog(name, 'disconnected');
    });

    socket.on('connect_error', (err) => {
      formatLog(name, `connect_error: ${err.message}`);
      reject(err);
    });

    for (const ev of events) {
      socket.on(ev, (data) => formatLog(name, ev, data));
    }
  });
}

async function run() {
  console.log('\n=== Starting Watch Party Room Integration Test ===\n');

  console.log('--- Step 1: Connecting Host (Alice) and creating room ---');
  const host = await connectClient('HOST (Alice)');

  let createdRoomId;
  const roomCreatedPromise = new Promise((resolve) => {
    host.once('room_created', (data) => {
      createdRoomId = data.roomId;
      resolve(data);
    });
  });

  host.emit('create_room', { username: 'Alice' });
  await roomCreatedPromise;
  console.log(`\nRoom successfully created with ID: ${createdRoomId}\n`);
  await wait(300);

  console.log('--- Step 2: Connecting Joiner (Bob) and joining room ---');
  const joiner = await connectClient('JOINER (Bob)');

  const roomJoinedPromise = new Promise((resolve) => joiner.once('room_joined', resolve));
  const userJoinedPromise = new Promise((resolve) => host.once('user_joined', resolve));

  joiner.emit('join_room', { roomId: createdRoomId, username: 'Bob' });
  await Promise.all([roomJoinedPromise, userJoinedPromise]);
  console.log('\nBob successfully joined the room.\n');
  await wait(300);

  console.log('--- Step 3: Disconnecting Host (Alice) to test auto-promotion ---');
  const roleAssignedPromise = new Promise((resolve) => joiner.once('role_assigned', resolve));
  const userLeftPromise = new Promise((resolve) => joiner.once('user_left', resolve));

  host.disconnect();

  const [roleAssignedData] = await Promise.all([roleAssignedPromise, userLeftPromise]);
  console.log(`\nAuto-promotion verified! ${roleAssignedData.username} was promoted to ${roleAssignedData.role}.\n`);
  await wait(300);

  console.log('--- Step 4: Cleanup ---');
  joiner.disconnect();
  await wait(300);

  console.log('=== Test finished successfully ===\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
