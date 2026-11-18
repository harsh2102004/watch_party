import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { roomManager } from "./models/RoomManager.js";
import { MessageHandler } from "./handlers/MessageHandler.js";
import { ChatHandler } from "./handlers/ChatHandler.js";
import { roomRepository } from "./services/RoomRepository.js";
import { connectDb, getDbStatus, closeDb } from "./db/connect.js";
import { authRouter } from "./routes/auth.js";
import { socketAuthMiddleware } from "./middleware/socketAuth.js";
import { expressCorsOptions, socketCorsOptions } from "./utils/cors.js";

dotenv.config();

// Fail startup in production if JWT_SECRET is missing
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET environment variable is required in production.");
  process.exit(1);
}

// Connect to MongoDB asynchronously without blocking server startup
connectDb().catch((err) => {
  console.warn(`[MongoDB] Initial connection error: ${err.message}`);
});

export const app = express();

app.use(cors(expressCorsOptions));
app.use(express.json());

// Mount authentication API
app.use("/auth", authRouter);

export const server = http.createServer(app);

export const io = new Server(server, {
  cors: socketCorsOptions,
});

// Socket authentication middleware
io.use(socketAuthMiddleware);

/**
 * Health check endpoint.
 * Returns server uptime, active in-memory room count, and persistent database status.
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    db: getDbStatus(),
    rooms: roomManager.rooms.size,
  });
});

// Instantiate handler once — shared io and roomManager (delegates ChatHandler)
export const messageHandler = new MessageHandler(io, roomManager);

io.on("connection", (socket) => {
  messageHandler.register(socket);
});

const PORT = Number(process.env.PORT) || 4000;
const HOST = "0.0.0.0";

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, HOST, () => {
    console.log(`Server listening on ${HOST}:${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  });
}

/**
 * Graceful shutdown handler.
 * Closes Socket.IO, stops accepting HTTP connections, and closes DB connections cleanly.
 *
 * @param {'SIGTERM' | 'SIGINT'} signal
 */
export function handleGracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Initiating graceful shutdown...`);

  // Stop accepting new socket connections and disconnect active clients
  io.close(() => {
    console.log('[Socket.IO] Closed all active socket connections.');
  });

  // Stop accepting new HTTP requests
  server.close(async () => {
    console.log('[HTTP] Server stopped listening for incoming requests.');

    // Clear active room sweepers
    messageHandler.clearAllSweepers();

    // Close database connection cleanly
    try {
      await closeDb();
      console.log('[MongoDB] Connection closed.');
    } catch (err) {
      console.warn('[MongoDB] Error during disconnect:', err.message);
    }

    console.log('[Server] Graceful shutdown completed cleanly.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  });

  // Failsafe: force exit if cleanup takes longer than 10 seconds
  const forceTimer = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out after 10s. Forcing exit.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }, 10000);

  if (forceTimer.unref) forceTimer.unref();
}

if (process.env.NODE_ENV !== "test") {
  process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
}
