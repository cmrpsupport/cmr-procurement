import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as Tesseract from 'tesseract.js';
import { saveDocument, getAllDocuments, getDocumentById, deleteDocument } from '../database';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif', 'application/pdf'];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// ULTRA-SIMPLE EXTRACTION FUNCTION - JUST WORKS
const extractSimpleData = (text: string) => {
  console.log("=== SIMPLE EXTRACTION STARTING ===");
  console.log("Text length:", text.length);
  console.log("First 200 chars:", text.substring(0, 200));
  
  const result = {
    supplier: "Not found",
    poNumber: "Not found",
    projectNumber: "Not found",
    jobNumber: "Not found", 
    doNumber: "Not found",
    date: "Not found",
    deliveryDate: "Not found",
    items: [],
    pageCount: 1
  };

  try {
    // Get supplier from first meaningful line
    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 3);
    
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const line = lines[i];
      if (line.length > 5 && /[A-Za-z]/.test(line) && !/(page|quantity|delivery order)/i.test(line)) {
        result.supplier = line;
        console.log("SUPPLIER:", line);
        break;
      }
    }
    
    // Find any alphanumeric pattern for PO
    const allText = text.replace(/\s+/g, ' ');
    const words = allText.split(' ').filter(w => w.length > 2);
    
    for (const word of words.slice(0, 100)) {
      // Look for patterns like PO55903, P055903, etc
      if (/^[A-Z]{1,3}\d{4,10}$/.test(word) || /^P[O0]?\d{4,10}$/.test(word)) {
        result.poNumber = word;
        console.log("PO NUMBER:", word);
        break;
      }
    }
    
    // Find any date pattern
    const datePatterns = [
      /\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/,
      /\d{1,2}\.\d{1,2}\.\d{4}/,
      /\d{1,2}\/\d{1,2}\/\d{4}/
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        result.date = match[0];
        console.log("DATE:", match[0]);
        break;
      }
    }
    
    // Find DO number (D followed by numbers)
    const doMatch = text.match(/\b(D\d{6,10})\b/i);
    if (doMatch) {
      result.doNumber = doMatch[1];
      console.log("DO NUMBER:", doMatch[1]);
    }
    
    // Find job number patterns
    const jobMatch = text.match(/\b(\d{5}YB)\b/i) || text.match(/job.*?(\w{4,10})/i);
    if (jobMatch) {
      result.jobNumber = jobMatch[1];
      console.log("JOB NUMBER:", jobMatch[1]);
    }

  } catch (error) {
    console.error("Simple extraction error:", error);
  }

  console.log("=== EXTRACTION RESULTS ===");
  console.log(result);
  return result;
};

// Split multi-page PDF into individual documents
const splitMultiPagePDF = (fullText: string, originalFileName: string, fileSize: number, totalPages: number) => {
  console.log("=== SPLITTING PDF INTO PAGES ===");
  console.log(`File: ${originalFileName}, Pages: ${totalPages}`);
  
  const documents = [];
  const pages = fullText.split(/=== PAGE \d+ START ===/);
  
  for (let i = 1; i < pages.length; i++) { // Skip first empty element
    let pageText = pages[i];
    
    // Clean up page markers
    pageText = pageText.replace(/=== PAGE \d+ END ===/g, '').trim();
    
    if (pageText.length > 50) { // Only process pages with content
      const baseName = originalFileName.replace(/\.(pdf|PDF)$/, '');
      documents.push({
        text: pageText,
        fileName: `${baseName}_Page${i}.pdf`,
        pageNumber: i,
        originalIndex: i - 1
      });
      console.log(`Created document: ${baseName}_Page${i}.pdf (${pageText.length} chars)`);
    }
  }
  
  console.log(`Split result: ${documents.length} documents`);
  return documents;
};

// Process single document
router.post('/process-document', upload.single('document'), async (req, res) => {
  try {
    console.log("=== PROCESSING DOCUMENT ===");
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log("File:", req.file.originalname, "Type:", req.file.mimetype, "Size:", req.file.size);

    // Check if client-side extracted PDF text
    if (req.body?.extractedText && req.body?.pageCount) {
      console.log("Processing PDF with client-side extracted text");
      const extractedText = req.body.extractedText;
      const pageCount = parseInt(req.body.pageCount, 10);
      
      // Split into individual documents
      const multipleDocuments = splitMultiPagePDF(extractedText, req.file.originalname, req.file.size, pageCount);
      
      const processedDocuments = [];
      for (let i = 0; i < multipleDocuments.length; i++) {
        const docData = multipleDocuments[i];
        const extractedData = extractSimpleData(docData.text);
        
        const result = {
          id: (Date.now() + i).toString(),
          originalName: docData.fileName,
          renamedName: `${extractedData.supplier || "Unknown"}_${extractedData.poNumber || "Unknown"}_${docData.fileName}`,
          type: req.file.mimetype,
          fileSize: req.file.size,
          status: "Processed" as const,
          supplier: extractedData.supplier,
          poNumber: extractedData.poNumber,
          projectNumber: extractedData.projectNumber,
          jobNumber: extractedData.jobNumber,
          doNumber: extractedData.doNumber,
          date: extractedData.date,
          extractedData: {
            ...extractedData,
            documentType: "pdf_multipage",
            confidence: 0.8,
            rawData: {
              originalText: docData.text,
              ocrMethod: "pdf.js + tesseract",
              fileName: docData.fileName,
              fileSize: req.file.size,
              pageCount: docData.pageNumber,
              pageIndex: i + 1
            }
          },
          filePath: null,
        };
        
        // Save to database
        await saveDocument(result);
        processedDocuments.push(result);
      }
      
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return res.json({ 
        results: processedDocuments, 
        processedCount: processedDocuments.length,
        multiDocument: true 
      });
    }
    
    // Process image files
    if (req.file.mimetype.startsWith('image/')) {
      console.log("Processing image file");
      
      // Use Tesseract for OCR
      const worker = await Tesseract.createWorker('eng');
      const { data: { text } } = await worker.recognize(req.file.path);
      await worker.terminate();
      
      console.log("OCR completed, text length:", text.length);
      
      const extractedData = extractSimpleData(text);
      
      const result = {
        id: Date.now().toString(),
        originalName: req.file.originalname,
        renamedName: `${extractedData.supplier || "Unknown"}_${extractedData.poNumber || "Unknown"}_${req.file.originalname}`,
        type: req.file.mimetype,
        fileSize: req.file.size,
        status: "Processed" as const,
        supplier: extractedData.supplier,
        poNumber: extractedData.poNumber,
        projectNumber: extractedData.projectNumber,
        jobNumber: extractedData.jobNumber,
        doNumber: extractedData.doNumber,
        date: extractedData.date,
        extractedData: {
          ...extractedData,
          documentType: "image_ocr",
          confidence: 0.75,
          rawData: {
            originalText: text,
            ocrMethod: "tesseract",
            fileName: req.file.originalname,
            fileSize: req.file.size
          }
        },
        filePath: null,
      };
      
      // Save to database
      await saveDocument(result);
      
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return res.json(result);
    }
    
    // Fallback for other file types
    res.status(400).json({ error: 'Unsupported file type' });

  } catch (error) {
    console.error("Document processing error:", error);
    
    // Clean up file if it exists
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: "Failed to process document", 
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Get all documents
router.get('/documents', async (req, res) => {
  try {
    const documents = await getAllDocuments();
    res.json(documents);
  } catch (error) {
    console.error("Error getting documents:", error);
    res.status(500).json({ error: "Failed to retrieve documents" });
  }
});

// Get document by ID
router.get('/documents/:id', async (req, res) => {
  try {
    const document = await getDocumentById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(document);
  } catch (error) {
    console.error("Error getting document:", error);
    res.status(500).json({ error: "Failed to retrieve document" });
  }
});

// Download document as CSV
router.get('/documents/:id/download', async (req, res) => {
  try {
    const document = await getDocumentById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Generate CSV content
    const csvData = [
      ['Field', 'Value'],
      ['Supplier', document.supplier || 'Not found'],
      ['PO Number', document.poNumber || 'Not found'],
      ['Project Number', document.projectNumber || 'Not found'],
      ['Job Number', document.jobNumber || 'Not found'],
      ['DO Number', document.doNumber || 'Not found'],
      ['Date', document.date || 'Not found'],
      ['File Name', document.originalName],
      ['File Size', document.fileSize?.toString() || 'Unknown']
    ];
    
    const csvContent = csvData.map(row => 
      row.map(field => `"${field}"`).join(',')
    ).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${document.supplier || 'document'}_${document.poNumber || 'data'}.csv"`);
    res.send(csvContent);
    
  } catch (error) {
    console.error("Error downloading document:", error);
    res.status(500).json({ error: "Failed to download document" });
  }
});

// Delete document
router.delete('/documents/:id', async (req, res) => {
  try {
    const document = await getDocumentById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const deleted = await deleteDocument(req.params.id);
    if (deleted) {
      res.json({ message: 'Document deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete document' });
    }
  } catch (error) {
    console.error("Error deleting document:", error);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

export default router;
