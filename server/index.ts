import "dotenv/config";
import { config } from "dotenv";

// Explicitly load .env file
config();
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { processDocument, processMultipleDocuments } from "./routes/document-processing";
import { 
  createBOMFile, 
  createBOMItems, 
  getBOMFiles, 
  getBOMFileById 
} from "./routes/bom";
import { 
  createPurchaseRequisitions, 
  getPurchaseRequisitions, 
  updatePurchaseRequisition, 
  deletePurchaseRequisition 
} from "./routes/purchase-requisitions";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Document processing routes
  app.post("/api/process-document", processDocument);
  app.post("/api/process-documents", processMultipleDocuments);

  // BOM routes
  app.post("/api/bom/files", createBOMFile);
  app.post("/api/bom/items", createBOMItems);
  app.get("/api/bom/files", getBOMFiles);
  app.get("/api/bom/files/:id", getBOMFileById);

  // Purchase Requisition routes
  app.post("/api/purchase-requisitions", createPurchaseRequisitions);
  app.get("/api/purchase-requisitions", getPurchaseRequisitions);
  app.put("/api/purchase-requisitions/:id", updatePurchaseRequisition);
  app.delete("/api/purchase-requisitions/:id", deletePurchaseRequisition);

  return app;
}
