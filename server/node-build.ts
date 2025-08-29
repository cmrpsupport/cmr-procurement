import path from "path";
import { createServer } from "./index";
import express from "express";

const app = createServer();
const port = process.env.PORT || 3000;

// In production, serve the built SPA files
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = path.join(__dirname, "../spa");

// Serve static files from the dist/spa directory
app.use(express.static(distPath));

// Handle React Router - serve index.html for all non-API routes
app.get("/", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.get("/report-builder", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.get("/document-assistant", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.get("/pr-generator", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Catch-all for other routes (but not API routes)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`🚀 Fusion Starter server running on port ${port}`);
  console.log(`📱 Frontend: http://localhost:${port}`);
  console.log(`🔧 API: http://localhost:${port}/api`);
  console.log(`📁 Static files served from: ${distPath}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  process.exit(0);
});
