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

// WORKING EXTRACTION - Handles raw OCR text properly
const extractSimpleData = (text: string) => {
  console.log("\n🔍 === STARTING EXTRACTION ===");
  console.log("📝 Input text length:", text.length);
  
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
    // Split into lines - handle various line break formats
    const lines = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    console.log(`📄 Total lines: ${lines.length}`);
    console.log("📝 First 5 lines:");
    lines.slice(0, 5).forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
    
    // Create fullText for pattern matching (remove extra spaces)
    const fullText = text.replace(/\s+/g, ' ');
    
    // STEP 1: Find supplier - look for company name
    console.log("\n🏢 FINDING SUPPLIER...");
    
    // First, try to find explicit supplier patterns (these often fail, so skip them)
    // We'll rely on line-by-line detection instead
    
    // Look in first 30 lines for company name
    for (let i = 0; i < Math.min(30, lines.length); i++) {
      const line = lines[i];
      
      // Look for company indicators
      if (line.match(/\b(Pte\.?\s*Ltd|PTELTD|Limited|Corporation|Corp\.?|Inc\.?|Company|Electronic|Enterprise|Supply|Industrial|Trading|Services?)\b/i)) {
        // Skip if it looks like an address, contact, footer, or "To:" line
        if (line.match(/(^To:|^From:|^Customer|^Signature|Stamp|^\d|Road|Street|Avenue|Crescent|Drive|Lane|Boulevard|Singapore\s*\d{6}|Tel:|Fax:|Email:|Website:|www\.|http|Page\s*\d|GST|Registration|Company\s*Registration\s*no|#\d{2}-\d{2}|Delivery\s*Order\s*No)/i)) {
          console.log(`  ⏭️ Skipping address/contact/recipient line: "${line.substring(0, 60)}..."`);
          continue;
        }
        
        // Skip very short lines (likely not a full company name)
        if (line.length < 8) {
          console.log(`  ⏭️ Skipping short line: "${line}"`);
          continue;
        }
        
        // Skip lines that are mostly special characters or numbers
        const alphaCount = (line.match(/[a-zA-Z]/g) || []).length;
        if (alphaCount < 5) {
          console.log(`  ⏭️ Skipping non-text line: "${line}"`);
          continue;
        }
        
        // Clean up OCR noise at the beginning (like "Ol Wd")
        let cleanedLine = line;
        cleanedLine = cleanedLine.replace(/^[A-Z][a-z]?\s+[A-Z][a-z]?\s+/,  ''); // Remove 1-2 letter words at start
        
        result.supplier = cleanedLine.trim();
        console.log(`✅ Found supplier in line ${i + 1}: "${cleanedLine.trim()}"`);
        break;
      }
    }
    
    // If still not found, try extracting from email domain
    if (result.supplier === "Not found") {
      console.log("  🔍 Trying to extract supplier from email domain...");
      const emailMatch = fullText.match(/Email:\s*\S+@([a-zA-Z0-9-]+)\./i);
      if (emailMatch && emailMatch[1]) {
        // Capitalize first letter
        const domain = emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1);
        result.supplier = domain;
        console.log(`✅ Found supplier from email domain: "${domain}"`);
      }
    }
    
    // If still not found, try extracting from company name patterns in text
    if (result.supplier === "Not found") {
      console.log("  🔍 Trying to extract supplier from full text patterns...");
      const companyPatterns = [
        /\b([A-Z][A-Za-z\s&]+(?:Pte\.?\s*Ltd|PTELTD|Ltd|Limited|Corporation|Corp|Inc))\b/gi,
      ];
      
      for (const pattern of companyPatterns) {
        const matches = fullText.match(pattern);
        if (matches && matches.length > 0) {
          // Take the first match that's not too long (likely not a paragraph)
          for (const match of matches) {
            if (match.length > 10 && match.length < 100 && 
                !match.match(/Customer|Signature|Stamp|Registration|Address|Freight/i)) {
              result.supplier = match.trim();
              console.log(`✅ Found supplier via text extraction: "${result.supplier}"`);
              break;
            }
          }
          if (result.supplier !== "Not found") break;
        }
      }
    }
    
    // STEP 2: Find PO Number
    console.log("\n📋 FINDING PO NUMBER...");
    
    // Look for "Your order no" or "PO" patterns with more flexibility
    const poPatterns = [
      // Labeled patterns (most reliable) - these match "Your order no.: PO55903"
      /Your\s*order\s*no\.?\s*:\s*(PO\d{5,6})/i,  // Exact match for "Your order no.: PO55903"
      /Your\s*P[\.\s]*O[\.\s]*No\.?\s*:\s*(PO\d{5,6})/i,  // "Your PO No: PO55918"
      /Your\s*order\s*no\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,  // Fallback with flexible format
      /Your\s*P[\.\s]*O[\.\s]*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /P\.?\s*O\.?\s*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /Purchase\s*Order\s*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /Order\s*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /P\.?O\.?\s*#?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      // Standalone patterns
      /\b(PO\d{5,6})\b/i,
      /\b(P\s*O\s*\d{5,6})\b/i,
      /\b(P\s*\d{5,6})\b(?!\.)/i  // P followed by numbers but not P.O.
    ];
    
    for (const pattern of poPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        let po = match[1];
        
        // Clean up the PO number
        po = po.replace(/\s+/g, ''); // Remove spaces
        po = po.replace(/[O]/g, '0'); // Replace O with 0
        
        // Ensure it starts with PO
        if (po.match(/^P\d/)) {
          po = 'PO' + po.substring(1);
        } else if (po.match(/^\d/)) {
          po = 'PO' + po;
        }
        
        // Remove leading zeros after PO (PO055903 -> PO55903)
        po = po.replace(/^PO0+(\d)/, 'PO$1');
        
        // Validate it looks like a real PO number
        if (po.match(/^PO\d{5,6}$/)) {
          result.poNumber = po;
          console.log(`✅ Found PO: "${po}" using pattern: ${pattern}`);
          break;
        } else {
          console.log(`  ⏭️ Rejected invalid PO format: "${po}"`);
        }
      }
    }
    
    // If still not found, try line-by-line search for context
    if (result.poNumber === "Not found") {
      console.log("  🔍 Trying line-by-line search...");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/order\s*no|po\s*no|purchase|p\.?o\.?[\s:]/i)) {
          // Check next line or same line for the number
          const combinedText = line + ' ' + (lines[i + 1] || '') + ' ' + (lines[i + 2] || '');
          
          // Try to find PO pattern
          const numberMatch = combinedText.match(/\b([A-Z]?\s*[O0]?\s*\d{5,6})\b/i);
          if (numberMatch) {
            let po = numberMatch[1].replace(/\s+/g, '').replace(/[O]/g, '0');
            if (po.match(/^P\d/)) {
              po = 'PO' + po.substring(1);
            } else if (po.match(/^\d{5,6}$/)) {
              po = 'PO' + po;
            }
            // Remove leading zeros
            po = po.replace(/^PO0+(\d)/, 'PO$1');
            
            if (po.match(/^PO\d{5,6}$/)) {
              result.poNumber = po;
              console.log(`✅ Found PO via line context: "${po}" at line ${i + 1}`);
              break;
            }
          }
        }
      }
    }
    
    // Final fallback: Look for any standalone 5-6 digit numbers that might be PO
    if (result.poNumber === "Not found") {
      console.log("  🔍 Final fallback: searching for any PO-like numbers...");
      for (const line of lines) {
        // Look for patterns like "PO: 55922" or "P.O. 55922"
        const poLikeMatch = line.match(/(?:PO|P\.O\.|Order)\s*[:#]?\s*(\d{5,6})/i);
        if (poLikeMatch) {
          let po = 'PO' + poLikeMatch[1];
          // Remove leading zeros
          po = po.replace(/^PO0+(\d)/, 'PO$1');
          result.poNumber = po;
          console.log(`✅ Found PO via fallback: "${po}"`);
          break;
        }
      }
    }
    
    // Ultra-aggressive fallback: Look for 5-6 digit numbers in context
    if (result.poNumber === "Not found") {
      console.log("  🔍 Ultra-aggressive PO search in document context...");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        // Check if this line or previous/next mention "po", "order", or "purchase"
        const contextLines = [
          lines[i - 1]?.toLowerCase() || '',
          line,
          lines[i + 1]?.toLowerCase() || ''
        ].join(' ');
        
        if (contextLines.match(/\b(po|order|purchase|ref|reference)\b/)) {
          // Look for 5-6 digit numbers in current line
          const numberMatch = lines[i].match(/\b(\d{5,6})\b/);
          if (numberMatch) {
            let po = 'PO' + numberMatch[1];
            po = po.replace(/^PO0+(\d)/, 'PO$1');
            result.poNumber = po;
            console.log(`✅ Found PO via context search at line ${i + 1}: "${po}"`);
            break;
          }
        }
      }
    }
    
    // STEP 3: Find DO/Delivery Number
    console.log("\n📦 FINDING DO NUMBER...");
    const doPatterns = [
      /Delivery\s*Order\s*No\.?\s*:\s*([A-Z]?\d{7,10})/i,  // "Delivery Order No. : D2508040"
      /Delivery\s*Order\s*No\.?\s*:\s*([A-Z]\d{6,10})/i,  // Letter + digits
      /Delivery:\s*(\d{7,12})/i,  // "Delivery: 826107562"
      /DO\s*No\.?\s*:?\s*([A-Z]?\d{6,12})/i,
      /D\.?O\.?\s*No\.?\s*:?\s*([A-Z]?\d{6,12})/i,
      /\b(D\d{7,10})\b/,  // D followed by 7-10 digits
      /\b(\d{9})\b/  // 9-digit numbers like 826107562
    ];
    
    for (const pattern of doPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        // Avoid Singapore postal codes (exactly 6 digits)
        if (!match[1].match(/^\d{6}$/)) {
          result.doNumber = match[1];
          console.log(`✅ Found DO: "${match[1]}" using pattern: ${pattern}`);
          break;
        }
      }
    }
    
    // Fallback: Look for DO in context
    if (result.doNumber === "Not found") {
      console.log("  🔍 Searching for DO number in context...");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/delivery|d\.?o\.?|order\s*no/i)) {
          // Look for DO-like numbers (7-9 digits or D followed by digits)
          const doMatch = line.match(/\b([D]\d{6,9}|\d{7,9})\b/i);
          if (doMatch && !doMatch[1].match(/^\d{6}$/)) { // Avoid postal codes
            result.doNumber = doMatch[1];
            console.log(`✅ Found DO via context: "${doMatch[1]}" at line ${i + 1}`);
            break;
          }
        }
      }
    }
    
    // STEP 4: Find Date
    console.log("\n📅 FINDING DATE...");
    const datePatterns = [
      /Delivery\s*(?:Order\s*)?date\s*:\s*(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})/i,  // "Delivery date: 08.08.2025"
      /Delivery\s*(?:Order\s*)?Date\s*:\s*(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})/i,  // "Delivery Order Date : 15.08.2025"
      /Date\s*:\s*(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})/i,
      /dated\s*:\s*(\w{3}\s+\d{1,2},\s*\d{4})/i,  // "dated: Aug 6, 2025"
      /\b(\d{2}[\.\/]\d{2}[\.\/]\d{4})\b/,  // Any 2-digit date like 08.08.2025 or 14/08/2025
      /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/,  // Any date with dots
      /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/   // Any date with slashes
    ];
    
    for (const pattern of datePatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        result.date = match[1];
        console.log(`✅ Found date: "${match[1]}"`);
        break;
      }
    }
    
    // Fallback: Look for any date in the document (first occurrence)
    if (result.date === "Not found") {
      console.log("  🔍 Searching for any date in document...");
      for (const line of lines) {
        const dateMatch = line.match(/\b(\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]20\d{2})\b/);
        if (dateMatch) {
          result.date = dateMatch[1];
          console.log(`✅ Found date via fallback: "${dateMatch[1]}"`);
          break;
        }
      }
    }
    
    // STEP 5: Find Job Number
    console.log("\n🔨 FINDING JOB NUMBER...");
    const jobPatterns = [
      /Your\s*Job\s*No\.?\s*:\s*([A-Z0-9]{5,10})/i,  // "Your Job No : 25006YB"
      /Job\s*No\.?\s*:\s*([A-Z0-9]{5,10})/i,
      /Job\s*No\s*:\s*([A-Z0-9]{5,10})/i,
      /Job:\s*([A-Z0-9]{5,10})/i
    ];
    
    for (const pattern of jobPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        result.jobNumber = match[1];
        console.log(`✅ Found job: "${match[1]}"`);
        break;
      }
    }
    
    // STEP 6: Find Items
    console.log("\n📦 FINDING ITEMS...");
    const itemLines: string[] = [];
    for (const line of lines) {
      // Look for quantity indicators (more flexible patterns)
      if (line.match(/\b\d+\s*(PC|PCS|pC|Pcs|pc|pcs|pieces?|Piece|PIECE)\b/i)) {
        // Should have some product description (lowered threshold)
        if (line.length > 15) {
          itemLines.push(line);
          console.log(`  ✓ Item: ${line.substring(0, 80)}...`);
          if (itemLines.length >= 15) break; // Increased limit
        }
      }
    }
    
    // If no items found, try alternative patterns
    if (itemLines.length === 0) {
      console.log("  🔍 No items with PC/PCS found, trying alternative patterns...");
      for (const line of lines) {
        // Look for lines with quantities and product-like text
        if (line.match(/\b\d+\s*x\s*/i) || line.match(/Qty[:\s]+\d+/i) || line.match(/Quantity[:\s]+\d+/i)) {
          if (line.length > 15 && line.length < 300) {
            itemLines.push(line);
            console.log(`  ✓ Alt item: ${line.substring(0, 80)}...`);
            if (itemLines.length >= 15) break;
          }
        }
      }
    }
    
    result.items = itemLines;
    console.log(`✅ Found ${itemLines.length} items`);

  } catch (error) {
    console.error("❌ ERROR in extraction:", error);
  }

  // Calculate weighted confidence based on business importance
  // Critical fields (70% total weight): Supplier, PO, DO, Date
  // Optional fields (30% total weight): Project, Job, Items
  
  let criticalScore = 0;
  let optionalScore = 0;
  
  // Critical fields (17.5% each = 70% total)
  if (result.supplier !== "Not found") criticalScore += 0.175;
  if (result.poNumber !== "Not found") criticalScore += 0.175;
  if (result.doNumber !== "Not found") criticalScore += 0.175;
  if (result.date !== "Not found") criticalScore += 0.175;
  
  // Optional fields (10% each = 30% total)
  if (result.projectNumber !== "Not found") optionalScore += 0.10;
  if (result.jobNumber !== "Not found") optionalScore += 0.10;
  if (result.items.length > 0) optionalScore += 0.10;
  
  const confidence = criticalScore + optionalScore;
  result.pageCount = confidence; // Store confidence in pageCount temporarily
  
  // Count fields for logging
  let foundFields = 0;
  let criticalFound = 0;
  if (result.supplier !== "Not found") { foundFields++; criticalFound++; }
  if (result.poNumber !== "Not found") { foundFields++; criticalFound++; }
  if (result.doNumber !== "Not found") { foundFields++; criticalFound++; }
  if (result.date !== "Not found") { foundFields++; criticalFound++; }
  if (result.projectNumber !== "Not found") foundFields++;
  if (result.jobNumber !== "Not found") foundFields++;
  if (result.items.length > 0) foundFields++;
  
  console.log("\n=== EXTRACTION COMPLETE ===");
  console.log("Supplier:", result.supplier);
  console.log("PO Number:", result.poNumber);
  console.log("DO Number:", result.doNumber);
  console.log("Date:", result.date);
  console.log("Job Number:", result.jobNumber);
  console.log("Items:", result.items.length);
  console.log(`📊 CONFIDENCE: ${(confidence * 100).toFixed(1)}% (${foundFields}/7 fields, ${criticalFound}/4 critical)`);
  console.log(`   Critical fields (70%): ${(criticalScore * 100).toFixed(1)}%`);
  console.log(`   Optional fields (30%): ${(optionalScore * 100).toFixed(1)}%`);
  console.log("===========================\n");
  
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
      console.log("📄 Processing PDF with client-side extracted text");
      console.log("📄 Extracted text length:", req.body.extractedText.length);
      console.log("📄 Page count:", req.body.pageCount);
      console.log("📄 First 200 chars of extracted text:", req.body.extractedText.substring(0, 200));
          const extractedText = req.body.extractedText;
          const pageCount = parseInt(req.body.pageCount, 10);
          
      // Split into individual documents
          const multipleDocuments = splitMultiPagePDF(extractedText, req.file.originalname, req.file.size, pageCount);
          
            const processedDocuments = [];
            for (let i = 0; i < multipleDocuments.length; i++) {
              const docData = multipleDocuments[i];
        const extractedData = extractSimpleData(docData.text);
              
              // Get actual confidence from extraction result
              const actualConfidence = extractedData.pageCount || 0; // We stored confidence in pageCount
              
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
            confidence: actualConfidence, // Use calculated confidence
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
      console.log("🖼️🖼️🖼️ PROCESSING IMAGE FILE 🖼️🖼️🖼️");
      console.log("File path:", req.file.path);
      console.log("File name:", req.file.originalname);
      
      // Use Tesseract for OCR
      console.log("🔍 Starting Tesseract OCR...");
      const worker = await Tesseract.createWorker('eng');
      const { data: { text } } = await worker.recognize(req.file.path);
      await worker.terminate();
      
      console.log("🎯 OCR completed, text length:", text.length);
      console.log("🎯 OCR raw text:");
      console.log(text);
      console.log("🎯 End OCR text");
      
      console.log("🔥 CALLING EXTRACTION FUNCTION");
      const extractedData = extractSimpleData(text);
      console.log("🔥 EXTRACTION FUNCTION RETURNED:", extractedData);

      // Get actual confidence from extraction result
      const actualConfidence = extractedData.pageCount || 0; // We stored confidence in pageCount

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
          confidence: actualConfidence, // Use calculated confidence
          rawData: {
            originalText: text,
            ocrMethod: "tesseract",
            fileName: req.file.originalname,
            fileSize: req.file.size
          }
        },
        filePath: null,
        debugInfo: {
          ocrTextLength: text.length,
          ocrFirstChars: text.substring(0, 200),
          extractionResults: extractedData
        }
      };
        
        // Save to database
      await saveDocument(result);
      
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return res.json(result);
    }
    
    // Handle PDF files without client-side extraction (fallback)
    if (req.file.mimetype === 'application/pdf') {
      console.log("📄 PROCESSING PDF FILE (server-side fallback)");
      console.log("File path:", req.file.path);
      console.log("File name:", req.file.originalname);
      
      // For now, create a simple result for PDFs that weren't processed client-side
      const extractedData = {
        supplier: "PDF processing requires client-side extraction",
        poNumber: "Not found",
        projectNumber: "Not found",
        jobNumber: "Not found",
        doNumber: "Not found",
        date: "Not found",
        deliveryDate: "Not found",
        items: [],
        pageCount: 1
      };
      
      const result = {
        id: Date.now().toString(),
        originalName: req.file.originalname,
        renamedName: `PDF_${req.file.originalname}`,
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
          documentType: "pdf_server_fallback",
          confidence: 0.1,
          rawData: {
            originalText: "PDF requires client-side processing for text extraction",
            ocrMethod: "server_fallback",
            fileName: req.file.originalname,
            fileSize: req.file.size,
            pageCount: 1
          }
        },
        filePath: req.file.path,
        debugInfo: {
          ocrTextLength: 0,
          ocrFirstChars: "PDF fallback processing",
          extractionResults: extractedData
        }
      };
      
      // Save to database
      await saveDocument(result);
      
      return res.json(result);
    }
    
    // Fallback for truly unsupported file types
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
      ['Job Number', 'Not found'], // Will be added later
      ['DO Number', document.extractedData?.deliveryNumber || 'Not found'],
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

// Update document fields (for manual editing)
router.patch('/documents/:id', async (req, res) => {
  try {
    const document = await getDocumentById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const { supplier, poNumber, projectNumber, jobNumber, doNumber, date } = req.body;
    
    // Update fields if provided
    if (supplier !== undefined) document.supplier = supplier;
    if (poNumber !== undefined) document.poNumber = poNumber;
    if (projectNumber !== undefined) document.projectNumber = projectNumber;
    if (jobNumber !== undefined) document.jobNumber = jobNumber;
    if (doNumber !== undefined) document.doNumber = doNumber;
    if (date !== undefined) document.date = date;
    
    // Update extracted data as well
    if (document.extractedData) {
      if (supplier !== undefined) document.extractedData.supplier = supplier;
      if (poNumber !== undefined) document.extractedData.poNumber = poNumber;
      if (projectNumber !== undefined) document.extractedData.projectNumber = projectNumber;
      if (jobNumber !== undefined) document.extractedData.jobNumber = jobNumber;
      if (doNumber !== undefined) document.extractedData.doNumber = doNumber;
      if (date !== undefined) document.extractedData.date = date;
      
      // Recalculate confidence after manual edit
      let criticalScore = 0;
      let optionalScore = 0;
      
      if (document.supplier && document.supplier !== "Not found") criticalScore += 0.175;
      if (document.poNumber && document.poNumber !== "Not found") criticalScore += 0.175;
      if (document.doNumber && document.doNumber !== "Not found") criticalScore += 0.175;
      if (document.date && document.date !== "Not found") criticalScore += 0.175;
      
      if (document.projectNumber && document.projectNumber !== "Not found") optionalScore += 0.10;
      if (document.jobNumber && document.jobNumber !== "Not found") optionalScore += 0.10;
      if (document.extractedData.items && document.extractedData.items.length > 0) optionalScore += 0.10;
      
      document.extractedData.confidence = criticalScore + optionalScore;
    }
    
    // Update renamed file name based on new data
    document.renamedName = `${document.supplier || "Unknown"}_${document.poNumber || "Unknown"}_${document.originalName}`;
    
    // Save updated document (you'll need to add an updateDocument function)
    const { default: Database } = await import('../database.js');
    const db = await Database.getDatabase();
    
    db.prepare(`
      UPDATE documents 
      SET supplier = ?, poNumber = ?, projectNumber = ?, jobNumber = ?, doNumber = ?, date = ?, 
          renamedName = ?, extractedData = ?
      WHERE id = ?
    `).run(
      document.supplier,
      document.poNumber,
      document.projectNumber,
      document.jobNumber,
      document.doNumber,
      document.date,
      document.renamedName,
      JSON.stringify(document.extractedData),
      req.params.id
    );
    
    console.log(`Document ${req.params.id} updated manually`);
    res.json(document);
    
  } catch (error) {
    console.error("Error updating document:", error);
    res.status(500).json({ error: "Failed to update document" });
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

// Router is exported as default for use in server/index.ts

export default router;
