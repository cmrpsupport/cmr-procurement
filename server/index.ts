import "dotenv/config";
import { config } from "dotenv";

// Explicitly load .env file
config();
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { processDocument, processMultipleDocuments } from "./routes/document-processing";
import { initDatabase, getAllDocuments, getDocumentById, deleteDocument } from "./database";

// Helper function to generate CSV content from document data
const generateCSVFromDocument = (doc: any): string => {
  const headers = ['Field', 'Extracted Value'];
  
  // Basic document information rows
  const basicRows = [
    ['Document Information', ''],
    ['Original File Name', doc.originalName || 'Not available'],
    ['Processed File Name', doc.renamedName || 'Not available'],
    ['File Size', doc.fileSize ? `${(doc.fileSize / 1024 / 1024).toFixed(1)} MB` : 'Not available'],
    ['Processing Date', doc.uploadTime || new Date().toLocaleString()],
    ['Number of Pages', doc.extractedData?.pageCount ? `${doc.extractedData.pageCount} pages` : '1 page'],
    ['', ''], // Empty row separator
    ['Extracted Data', ''],
    ['Supplier Name', doc.extractedData?.supplier || 'Not found'],
    ['PO Number', doc.extractedData?.poNumber || 'Not found'],
    ['Project Number', doc.extractedData?.projectNumber || 'Not found'],
    ['Date', doc.extractedData?.date || 'Not found'],
    ['Delivery Date', doc.extractedData?.deliveryDate || 'Not found'],
    ['Total Amount', doc.extractedData?.totalAmount || 'Not found']
  ];

  // Handle items - list them individually if there are any
  const itemRows: string[][] = [];
  if (doc.extractedData?.items && doc.extractedData.items.length > 0) {
    itemRows.push(['', '']); // Empty row separator
    itemRows.push(['Items Delivered', '']);
    itemRows.push(['Total Items Found', `${doc.extractedData.items.length} items`]);
    itemRows.push(['', '']); // Another separator
    
    // List each item individually with numbering
    doc.extractedData.items.forEach((item: string, index: number) => {
      itemRows.push([`Item ${index + 1}`, item.trim()]);
    });
  } else {
    itemRows.push(['', '']);
    itemRows.push(['Items Delivered', 'No items found']);
  }

  // Combine all rows
  const allRows = [...basicRows, ...itemRows];
  
  const csvContent = [
    headers.join(','),
    ...allRows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');
  
  return csvContent;
};
import fs from "fs";
import path from "path";

export function createServer() {
  const app = express();

  // Initialize database
  initDatabase();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // API routes
  app.get("/api/ping", (req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  // Google Vision test endpoint removed - service no longer used
  // App now uses client-side PDF.js + Tesseract for better performance

  app.get("/api/demo", handleDemo);

  // Document processing routes
  app.post("/api/process-document", processDocument);
  app.post("/api/process-documents", processMultipleDocuments);
  
  // Document storage and retrieval routes
  app.get("/api/documents", (req, res) => {
    try {
      const documents = getAllDocuments();
      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });
  
  app.get("/api/documents/:id/download", (req, res) => {
    try {
      console.log(`📥 CSV download request for document ID: ${req.params.id}`);
      const document = getDocumentById(req.params.id);
      console.log('📄 Document found:', document ? 'Yes' : 'No');
      
      if (!document) {
        console.log('❌ Document not found in database');
        return res.status(404).json({ error: "Document not found" });
      }
      
      console.log('📊 Generating CSV content for document');
      
      // Generate CSV content from extracted data
      const csvContent = generateCSVFromDocument(document);
      const fileName = `${document.supplier || 'Unknown'}_${document.poNumber || 'Unknown'}_extracted_data.csv`;
      
      console.log(`✅ CSV generated, filename: ${fileName}`);
      
      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(csvContent);
      
    } catch (error) {
      console.error("❌ Error generating CSV download:", error);
      res.status(500).json({ error: "Failed to generate CSV download" });
    }
  });

  // Get single document by ID
  app.get("/api/documents/:id", (req, res) => {
    try {
      const document = getDocumentById(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json(document);
    } catch (error) {
      console.error("Error fetching document:", error);
      res.status(500).json({ error: "Failed to fetch document" });
    }
  });

  // Delete document
  app.delete("/api/documents/:id", (req, res) => {
    try {
      const document = getDocumentById(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Delete file from disk if it exists
      if (document.filePath) {
        const filePath = path.join(process.cwd(), document.filePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Delete from database
      const deleted = deleteDocument(req.params.id);
      if (deleted) {
        res.json({ message: "Document deleted successfully" });
      } else {
        res.status(500).json({ error: "Failed to delete document" });
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

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
