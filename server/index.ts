import "dotenv/config";
import { config } from "dotenv";

// Explicitly load .env file
config();
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { handleDemo } from "./routes/demo";
import documentProcessingRouter from "./routes/document-processing";
import { initDatabase, getAllDocuments, getDocumentById, deleteDocument } from "./database";
import { generateExcelReport, generateSingleDocumentExcel } from "./services/excel-export-service";

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

export function createServer() {
  const app = express();

  // Initialize database
  initDatabase();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Serve static files from public directory (multiple paths for different environments)
  const publicPaths = [
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "dist/spa"),
    path.join(__dirname, "../public"),
    path.join(__dirname, "../dist/spa"),
    path.join(__dirname, "../../public") // Additional path for production
  ];
  
  // Try to serve from multiple paths to ensure static files work
  let staticFileServed = false;
  for (const publicPath of publicPaths) {
    if (fs.existsSync(publicPath)) {
      console.log(`Serving static files from: ${publicPath}`);
      app.use(express.static(publicPath, {
        maxAge: '1d', // Cache static files for 1 day
        setHeaders: (res, path) => {
          if (path.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
          }
        }
      }));
      staticFileServed = true;
    }
  }
  
  if (!staticFileServed) {
    console.log('Warning: No public directory found for static file serving');
  }

  // Serve static assets like logo
  app.get("/cmr-logo.png", (req, res) => {
    try {
      const possiblePaths = [
        path.resolve(process.cwd(), "public/cmr-logo.png"),
        path.resolve(process.cwd(), "dist/spa/cmr-logo.png"),
        path.resolve(__dirname, "../public/cmr-logo.png"),
        path.resolve(__dirname, "../dist/spa/cmr-logo.png"),
        path.resolve(__dirname, "../../public/cmr-logo.png")
      ];
      
      for (const logoPath of possiblePaths) {
        if (fs.existsSync(logoPath)) {
          console.log(`Serving logo from: ${logoPath}`);
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          
          // Try sendFile first, fallback to direct read if it fails
          try {
            return res.sendFile(path.resolve(logoPath));
          } catch (sendFileError) {
            console.log("sendFile failed, trying direct read:", sendFileError);
            const logoBuffer = fs.readFileSync(logoPath);
            return res.send(logoBuffer);
          }
        }
      }
      
      console.log("Logo not found in any of these paths:", possiblePaths);
      res.status(404).json({ error: "Logo not found", searchedPaths: possiblePaths });
    } catch (error) {
      console.error("Error serving logo:", error);
      res.status(500).json({ error: "Internal server error serving logo", details: error.message });
    }
  });

  // Debug route to check file system
  app.get("/api/debug-logo", (req, res) => {
    const possiblePaths = [
      path.join(process.cwd(), "public/cmr-logo.png"),
      path.join(process.cwd(), "dist/spa/cmr-logo.png"),
      path.join(__dirname, "../public/cmr-logo.png"),
      path.join(__dirname, "../dist/spa/cmr-logo.png"),
      path.join(__dirname, "../../public/cmr-logo.png")
    ];
    
    const pathsStatus = possiblePaths.map(p => ({
      path: p,
      exists: fs.existsSync(p),
      size: fs.existsSync(p) ? fs.statSync(p).size : null
    }));
    
    // Check if static middleware is working
    const staticMiddlewareTest = fs.readdirSync(process.cwd()).slice(0, 5);
    
    res.json({
      cwd: process.cwd(),
      __dirname,
      environment: process.env.NODE_ENV || 'development',
      paths: pathsStatus,
      rootFiles: staticMiddlewareTest,
      logoUrl: '/cmr-logo.png',
      testMessage: 'Check these paths to see where your logo should be placed on Render'
    });
  });

  // API routes
  app.get("/api/ping", (req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  // Google Vision test endpoint removed - service no longer used
  // App now uses client-side PDF.js + Tesseract for better performance

  app.get("/api/demo", handleDemo);

  // Document processing routes
  app.use("/api", documentProcessingRouter);

  // Document storage and retrieval routes
  app.get("/api/documents", async (req, res) => {
    try {
      const documents = await getAllDocuments();
      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });
  
  app.get("/api/documents/:id/download", async (req, res) => {
    try {
      console.log(`📥 CSV download request for document ID: ${req.params.id}`);
      const document = await getDocumentById(req.params.id);
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

  // Excel export - Single document
  app.get("/api/documents/:id/excel", async (req, res) => {
    console.log('🔥🔥🔥 EXCEL ENDPOINT HIT - Single document:', req.params.id);
    try {
      const document = await getDocumentById(req.params.id);
      if (!document) {
        console.log('❌ Document not found:', req.params.id);
        return res.status(404).json({ error: "Document not found" });
      }

      console.log(`📊 Generating Excel export for SINGLE document:`);
      console.log(`   ID: ${document.id}`);
      console.log(`   Original Name: ${document.originalName}`);
      console.log(`   Supplier: ${document.supplier}`);
      console.log(`   PO Number: ${document.poNumber}`);
      console.log(`   DO Number: ${document.doNumber}`);

      const excelBuffer = await generateSingleDocumentExcel(document);

      console.log(`✅ Excel buffer generated, size: ${excelBuffer.length} bytes`);

      const fileName = `${document.originalName.replace(/\.[^/.]+$/, '')}_export.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', excelBuffer.length.toString());
      res.send(excelBuffer);

      console.log(`✅ Excel export sent: ${fileName}`);

    } catch (error) {
      console.error("❌ Error generating Excel export:", error);
      res.status(500).json({ error: "Failed to generate Excel export" });
    }
  });

  // Excel export - All documents (bulk)
  app.get("/api/documents/export/excel-all", async (req, res) => {
    console.log('🔥🔥🔥 EXCEL ENDPOINT HIT - Bulk export');
    try {
      const documents = await getAllDocuments();

      if (!documents || documents.length === 0) {
        console.log('❌ No documents found to export');
        return res.status(404).json({ error: "No documents found to export" });
      }

      console.log(`📊 Generating bulk Excel export for ${documents.length} documents`);

      const excelBuffer = await generateExcelReport(documents);

      const fileName = `CMR_Procurement_Export_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', excelBuffer.length.toString());
      res.send(excelBuffer);

      console.log(`✅ Bulk Excel export sent: ${fileName} (${documents.length} documents)`);

    } catch (error) {
      console.error("❌ Error generating bulk Excel export:", error);
      res.status(500).json({ error: "Failed to generate bulk Excel export" });
    }
  });

  // Get single document by ID
  app.get("/api/documents/:id", async (req, res) => {
    try {
      const document = await getDocumentById(req.params.id);
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
  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const document = await getDocumentById(req.params.id);
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
      const deleted = await deleteDocument(req.params.id);
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
