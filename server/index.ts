import "dotenv/config";
import { config } from "dotenv";

// Explicitly load .env file
config();
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { processDocument, processMultipleDocuments } from "./routes/document-processing";
import fs from "fs";
import path from "path";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // API routes
  app.get("/api/ping", (req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Document processing routes
  app.post("/api/process-document", processDocument);
  app.post("/api/process-documents", processMultipleDocuments);

  // Health check route
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Test route to check if logo file exists
  app.get("/api/test-logo", (req, res) => {
    const logoPath = path.join(process.cwd(), "dist/spa/cmr-logo.png");
    const exists = fs.existsSync(logoPath);
    res.json({ 
      logoExists: exists, 
      logoPath,
      cwd: process.cwd(),
      files: fs.readdirSync(path.join(process.cwd(), "dist/spa"))
    });
  });

  return app;
}
