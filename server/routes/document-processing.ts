import { RequestHandler } from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { saveDocument } from "../database";
import { createGoogleVisionService, GoogleVisionDocumentService } from "../services/google-vision-service";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", 
      "image/jpg",
      "image/png", 
      "image/tiff",
      "image/tif",
      "application/pdf",
      "text/plain"  // Allow text files for pre-extracted PDF text
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPG, PNG, TIFF, PDF, and TXT files are allowed."));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Helper function to split multi-page PDF into separate documents
const splitMultiPagePDF = (fullText: string, originalFileName: string, fileSize: number, totalPages: number) => {
  console.log("=== SPLITTING MULTI-PAGE PDF ===");
  console.log(`Total pages: ${totalPages}, Original filename: ${originalFileName}`);
  
  // Split by page separators
  const pages = fullText.split(/--- Page \d+ ---/);
  const documents = [];
  
  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i].trim();
    if (pageText.length < 50) continue; // Skip very short pages
    
    console.log(`\n--- Processing Page ${i + 1} ---`);
    console.log(`Page text length: ${pageText.length}`);
    console.log(`First 200 chars: ${pageText.substring(0, 200)}`);
    
    // Detect if this page contains a delivery order/invoice
    const isDeliveryDocument = (
      /delivery\s*order/i.test(pageText) ||
      /invoice/i.test(pageText) ||
      /delivery/i.test(pageText) ||
      /purchase\s*order/i.test(pageText) ||
      /quotation/i.test(pageText)
    );
    
    // Detect company/supplier patterns on this page
    const companyPatterns = [
      /(WAGO\s+Electronic\s+Pte\s+Ltd)/i,
      /(SENCONIX\s+PTE\s+LTD)/i,
      /(WAH\s+LEI\s+INDUSTRIAL\s+SUPPLY\s+CO\.\s+PTE\.\s+LTD\.)/i,
      /(SCL\s+System\s+Enterprise\s+Pte\s+Ltd)/i,
      /([A-Z][A-Za-z\s&.,]{5,50}(?:Pte\s+Ltd|Private\s+Limited|Inc|Corp|Ltd|LLC|Co))/i
    ];
    
    let detectedCompany = null;
    for (const pattern of companyPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        detectedCompany = match[1].trim();
        console.log(`Detected company: ${detectedCompany}`);
        break;
      }
    }
    
    if (isDeliveryDocument && detectedCompany) {
      // Generate filename for this document
      const pageNumber = i + 1;
      const baseName = originalFileName.replace(/\.(pdf|PDF)$/, '');
      const documentFileName = `${baseName}_Page${pageNumber}.pdf`;
      
      documents.push({
        text: pageText,
        fileName: documentFileName,
        pageNumber: pageNumber,
        detectedCompany: detectedCompany,
        originalIndex: i
      });
      
      console.log(`✅ Added document: ${documentFileName} (Company: ${detectedCompany})`);
    } else {
      console.log(`❌ Skipped page ${i + 1} - Not a delivery document or no company detected`);
      console.log(`  - Is delivery document: ${isDeliveryDocument}`);
      console.log(`  - Detected company: ${detectedCompany}`);
    }
  }
  
  console.log(`\n=== SPLIT RESULT: ${documents.length} documents found ===`);
  documents.forEach((doc, idx) => {
    console.log(`${idx + 1}. ${doc.fileName} - ${doc.detectedCompany}`);
  });
  console.log("=== END SPLITTING ===\n");
  
  return documents;
};

// Helper function to correct common OCR mistakes
const correctOCRText = (text: string): string => {
  const corrections: [RegExp, string][] = [
    // Common OCR misreadings
    [/SEAMP/gi, 'STAMP'],
    [/SIGNATUPE/gi, 'SIGNATURE'], 
    [/COMPANYSEAMP/gi, 'COMPANY STAMP'],
    [/CUSTOMEFI/gi, 'CUSTOMER'],
    [/CUSTOMEP/gi, 'CUSTOMER'],
    [/CHOP/gi, 'CHOP'],
    [/LOGISTIGS/gi, 'LOGISTICS'],
    [/SIGNATUFE/gi, 'SIGNATURE'],
    [/SIGNATIJRE/gi, 'SIGNATURE'],
    [/SIGNATURF/gi, 'SIGNATURE'],
    
    // SENCONIX company name corrections
    [/SENC.?NIX/gi, 'SENCONIX PTE LTD'],
    [/SENG.?NIX/gi, 'SENCONIX PTE LTD'],
    [/SS\s+J\s+ei\s+wf\s+i\s+fe\s+BYE\s+LTD/gi, 'SENCONIX PTE LTD'],
    [/SS\s+J\s+.*?\s+BYE\s+LTD/gi, 'SENCONIX PTE LTD'],
    
    // WAGO company name corrections - comprehensive variations
    [/WAGQ\s+Electronic\s+Pte\s+Ltd/gi, 'WAGO Electronic Pte Ltd'],
    [/WAG[OQ0]\s+Electronic\s+Pte\s+Ltd/gi, 'WAGO Electronic Pte Ltd'],
    [/W[A4]GO\s+Electronic\s+Pte\s+Ltd/gi, 'WAGO Electronic Pte Ltd'],
    [/WAG[OQ0]Electronic\s+Pte\s+Ltd/gi, 'WAGO Electronic Pte Ltd'],
    [/WAQO\s+Electronic\s+Pte\s+Ltd/gi, 'WAGO Electronic Pte Ltd'],
    [/W[A4]G[OQ0]\s+Electronic\s+Pte\s+Ltd/gi, 'WAGO Electronic Pte Ltd'],
    [/WAG[OQ0].*?Electronic.*?Pte.*?Ltd/gi, 'WAGO Electronic Pte Ltd'],
    // Fix email domain issues in company name matching
    [/wago\.com[^\n]*(?=\n)/gi, 'info-sing@wago.com'],
    
    // Address pattern corrections
    [/(\d+)\s+J[o0][o0]\s+S[e3]ng\s+R[o0][a4]d/gi, '$1 Joo Seng Road'],
    [/J[o0][o0]\s+S[e3]ng/gi, 'Joo Seng'],
    [/R[o0][a4]d/gi, 'Road'],
    
    // Number confusions
    [/O(\d)/g, '0$1'], // O confused with 0
    [/(\d)O/g, '$10'], // O confused with 0
    [/l(\d)/g, '1$1'], // l confused with 1
    [/(\d)l/g, '$11'], // l confused with 1
    [/Q(?=\s|$)/g, 'O'], // Q -> O at word boundaries
    [/8(?=\s+[A-Z])/g, 'B'], // 8 -> B before capital letters
    [/5(?=\s+[A-Z])/g, 'S'], // 5 -> S before capital letters
  ];
  
  let correctedText = text;
  corrections.forEach(([pattern, replacement]) => {
    correctedText = correctedText.replace(pattern, replacement);
  });
  
  return correctedText;
};

// Helper function to extract data from text with improved patterns
const extractDataFromText = (text: string) => {
  console.log("=== EXTRACTING DATA FROM TEXT ===");
  
  // Apply OCR corrections first
  const correctedText = correctOCRText(text);
  
  console.log("Text length:", correctedText.length);
  console.log("First 1000 characters:", correctedText.substring(0, 1000));
  console.log("\n===== COMPLETE EXTRACTED TEXT =====");
  console.log(correctedText);
  console.log("===== END COMPLETE TEXT =====\n");
  console.log("================================");
  
  // Use corrected text for extraction
  text = correctedText;
  
  const extractedData: any = {
    supplier: "",
    poNumber: "",
    projectNumber: "",
    jobNumber: "",
    doNumber: "",
    date: "",
    deliveryDate: "",
    items: [],
    pageCount: 1, // Default to single page
  };

  try {
    // Extract supplier name with comprehensive patterns for delivery orders
    const supplierPatterns = [
      // High priority: Specific company patterns first
      /(WAGO\s+Electronic\s+Pte\s+Ltd)/i,
      /(SENCONIX\s+PTE\s+LTD)/i,
      
      // Standard supplier patterns
      /supplier[:\s]+([^\n\r,;]+)/i,
      /vendor[:\s]+([^\n\r,;]+)/i,
      /delivered by[:\s]+([^\n\r,;]+)/i,
      /supplier name[:\s]+([^\n\r,;]+)/i,
      /from[:\s]+([^\n\r,;]+)/i,
      /business name[:\s]+([^\n\r,;]+)/i,
      /contractor[:\s]+([^\n\r,;]+)/i,
      /seller[:\s]+([^\n\r,;]+)/i,
      /shipper[:\s]+([^\n\r,;]+)/i,
      /sold\s*by[:\s]+([^\n\r,;]+)/i,
      /ship\s*from[:\s]+([^\n\r,;]+)/i,
      /firm[:\s]+([^\n\r,;]+)/i,
      /organization[:\s]+([^\n\r,;]+)/i,
      
      // Company names with global suffixes (high priority, before generic patterns)
      /([A-Z][A-Za-z\s&.,]+(?:Pte\s+Ltd|Private\s+Limited|Pvt\s+Ltd|Inc|Corp|Ltd|LLC|Co|GmbH|SA|SRL|BV|AB|AS|SpA|SPA)\.?)/i,
      
      // Electronic companies pattern (to catch WAGO variations)
      /([A-Z][A-Za-z\s&.,]*Electronic[s]?\s+(?:Pte\s+Ltd|Ltd|Inc|Corp|Co))/i,
      
      // First line company pattern (many DOs start with supplier name)
      /^([A-Z][A-Za-z\s&.,]{5,60}(?:Pte\s+Ltd|Ltd|Inc|Corp|Co|Electronic|Electronics|Trading|Services|Solutions|Supply|Engineering|Technology|Systems|International|Manufacturing))/im,
      
      // Company-like names in first few lines  
      /^([A-Z][A-Z\s&.,]+(?:INC|CORP|LTD|LLC|CO|PTE|PVT|GMBH|SA|SRL|BV)[A-Z\s.,]*)/im,
      
      // All-caps business names (but not too generic)
      /^([A-Z][A-Z\s&.,]{10,50})/m,
      
      // Industry-specific company patterns
      /^([A-Z][A-Za-z\s&.,]+(?:Electronic|Electronics|Industries|Trading|Services|Solutions|Supply|Supplies|Engineering|Technology|Systems|International|Global|Manufacturing|Equipment|Tools|Materials|Construction|Electrical|Mechanical)[A-Za-z\s.,]*)/im,
      
      // After common delivery order headers
      /(?:bill\s*to|ship\s*to|deliver\s*to|consignee)[:\s]*\n?\s*([A-Z][A-Za-z\s&.,]+(?:Ltd|Inc|Corp|LLC|Co|Pte)[A-Za-z\s.,]*)/im,
      
      // LOWER priority: company field (often contains stamps/seals)
      /company[:\s]+([^\n\r,;]+)/i,
    ];

    console.log("\n=== SUPPLIER EXTRACTION ===");
    for (let i = 0; i < supplierPatterns.length; i++) {
      const pattern = supplierPatterns[i];
      const match = text.match(pattern);
      console.log(`Pattern ${i+1}/${supplierPatterns.length}: ${pattern}`);
      console.log(`Match result:`, match);
      if (match && match[1]) {
        let supplier = match[1].trim();
        console.log(`Raw supplier match: "${supplier}"`);
        // Clean up the supplier name
        supplier = supplier.replace(/[:\s]+$/, ''); // Remove trailing colons/spaces
        supplier = supplier.replace(/^\s*[-•*]\s*/, ''); // Remove leading bullets
        supplier = supplier.replace(/\s+/g, ' '); // Normalize spaces
        supplier = supplier.replace(/WAGQ/g, 'WAGO'); // Fix common OCR error
        supplier = supplier.replace(/WAG[OQ0]/g, 'WAGO'); // Fix OCR variations
        supplier = supplier.replace(/Electronic\s+Pte\s+Ltd.*$/i, 'Electronic Pte Ltd'); // Clean trailing text
        supplier = supplier.replace(/\s*-\s*[^-]*$/, ''); // Remove trailing descriptions after dash
        
        // Filter out invalid supplier names
        const invalidSuppliers = [
          'stamp', 'signature', 'company stamp', 'customer signature',
          'chop', 'seal', 'date', 'no', 'number', 'ref', 'reference'
        ];
        
        const isInvalidSupplier = invalidSuppliers.some(invalid => 
          supplier.toLowerCase().includes(invalid.toLowerCase())
        );
        
        if (isInvalidSupplier) {
          console.log(`❌ Supplier rejected: contains invalid keyword ("${supplier}")`);
          continue;
        }
        
        if (supplier.length > 2 && supplier.length < 100) {
          console.log(`✅ SUPPLIER FOUND: "${supplier}" using pattern ${i+1}`);
          extractedData.supplier = supplier;
          break;
        } else {
          console.log(`❌ Supplier rejected - length: ${supplier.length}`);
        }
      } else {
        console.log(`❌ No match for pattern ${i+1}`);
      }
    }
    console.log(`Final supplier result: "${extractedData.supplier}"`);
    console.log("=== END SUPPLIER EXTRACTION ===\n");
    
    // Manual extraction for WAGO document if patterns fail
    if (!extractedData.supplier || extractedData.supplier.length < 5) {
      // Look for specific company patterns in the text - handle OCR errors like WAGQ -> WAGO
      const wagoMatch = text.match(/(WAGQ\s+Electronic\s+Pte\s+Ltd|WAGO\s+Electronic\s+Pte\s+Ltd)/i);
      if (wagoMatch) {
        extractedData.supplier = wagoMatch[1].replace('WAGQ', 'WAGO'); // Fix OCR error
        console.log('Manual WAGO supplier extraction successful:', extractedData.supplier);
      } else {
        // Look for other company patterns
        const companyMatch = text.match(/([A-Z][A-Za-z\s&]+\s+(?:Pte\s+Ltd|Private\s+Limited|Inc|Corp|Ltd|LLC))/i);
        if (companyMatch) {
          extractedData.supplier = companyMatch[1].trim();
          console.log('Manual company extraction successful:', extractedData.supplier);
        }
      }
    }

    // Extract PO Number with comprehensive patterns (prioritize specific patterns first)
    const poPatterns = [
      // Prioritize specific delivery order patterns first
      /your\s+order\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /your\s+po\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /order\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      // Look for standalone PO patterns
      /\b(PO\d{4,10})\b/i,
      /\b(po\d{4,10})\b/i,
      // Standard PO patterns (moved after specific ones)
      /po\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /order\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /purchase\s*order\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /purchase\s*#[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /ref\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /reference[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      // Look for patterns like "PO: 12345" or "P.O. 12345" (moved to end to avoid "Position" match)
      /p\.?o\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      // Generic patterns last (made more specific to avoid "Delivery Order Page" matches)
      /order\s*#[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      // Very generic patterns last (removed overly broad numeric patterns to prevent false matches)
    ];

    console.log("\n=== PO NUMBER EXTRACTION ===");
    for (let i = 0; i < poPatterns.length; i++) {
      const pattern = poPatterns[i];
      const match = text.match(pattern);
      console.log(`PO Pattern ${i+1}/${poPatterns.length}: ${pattern}`);
      console.log(`PO Match result:`, match);
      if (match && match[1]) {
        let poNumber = match[1].trim();
        console.log(`Raw PO match: "${poNumber}"`);
        // Validate that it looks like a reasonable PO number
        const isValidFormat = /^[a-zA-Z0-9\-_\/]+$/.test(poNumber);
        const isValidLength = poNumber.length >= 3 && poNumber.length <= 20;
        console.log(`PO validation - Length: ${poNumber.length}, Format valid: ${isValidFormat}, Length valid: ${isValidLength}`);
        if (isValidLength && isValidFormat) {
          console.log(`✅ PO NUMBER FOUND: "${poNumber}" using pattern ${i+1}`);
          extractedData.poNumber = poNumber;
          break;
        } else {
          console.log(`❌ PO rejected - length: ${poNumber.length}, format valid: ${isValidFormat}`);
        }
      } else {
        console.log(`❌ No match for PO pattern ${i+1}`);
      }
    }
    console.log(`Final PO result: "${extractedData.poNumber}"`);
    console.log("=== END PO EXTRACTION ===\n");
    
    // Manual extraction for PO pattern if patterns fail or get wrong results
    if (!extractedData.poNumber || extractedData.poNumber.length < 3 || extractedData.poNumber === 'sition') {
      console.log('Running manual PO extraction due to poor match:', extractedData.poNumber);
      // Look for "Your order no.: PO55903" pattern specifically
      const yourOrderMatch = text.match(/Your\s+order\s+no\.?\s*:\s*(PO\d+)/i);
      if (yourOrderMatch) {
        extractedData.poNumber = yourOrderMatch[1];
        console.log('Manual "Your order no." PO extraction successful:', extractedData.poNumber);
      } else {
        // Look for standalone PO pattern
        const manualPO = text.match(/\b(PO\d{4,10})\b/i);
        if (manualPO) {
          extractedData.poNumber = manualPO[1];
          console.log('Manual standalone PO extraction successful:', extractedData.poNumber);
        }
      }
    }

    // Extract Project Number - ONLY when there's a clear project label (NO job patterns)
    const projectPatterns = [
      // ONLY extract when there's explicit labeling for project numbers
      /project\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /project\s*#[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /project\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /prj\.?\s*#?[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /contract\s*#?[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /work\s*order[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      // Look for explicit reference labels with project context only
      /(?:your|our)\s*(?:ref|reference)\s*(?:project)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /project\s*(?:ref|reference|code)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      // Look for patterns like "PRJ-12345" or "PROJ-12345" (clear project prefixes only)
      /\b(PRJ[-_]?[a-zA-Z0-9]{2,15})\b/i,
      /\b(PROJ[-_]?[a-zA-Z0-9]{2,15})\b/i
    ];

    console.log("\n=== PROJECT NUMBER EXTRACTION ===");
    for (let i = 0; i < projectPatterns.length; i++) {
      const pattern = projectPatterns[i];
      const match = text.match(pattern);
      console.log(`Project Pattern ${i+1}/${projectPatterns.length}: ${pattern}`);
      console.log(`Project Match result:`, match);
      if (match && match[1]) {
        let projectNumber = match[1].trim();
        console.log(`Raw project match: "${projectNumber}"`);
        const isValidLength = projectNumber.length >= 2 && projectNumber.length <= 20;
        console.log(`Project validation - Length: ${projectNumber.length}, Valid: ${isValidLength}`);
        if (isValidLength) {
          console.log(`✅ PROJECT NUMBER FOUND: "${projectNumber}" using pattern ${i+1}`);
          extractedData.projectNumber = projectNumber;
          break;
        } else {
          console.log(`❌ Project rejected - length: ${projectNumber.length}`);
        }
      } else {
        console.log(`❌ No match for project pattern ${i+1}`);
      }
    }
    console.log(`Final project result: "${extractedData.projectNumber}"`);
    console.log("=== END PROJECT EXTRACTION ===\n");
    
    // Manual extraction for project numbers only with clear labels
    if (!extractedData.projectNumber || extractedData.projectNumber.length < 3 || extractedData.projectNumber === 'http' || extractedData.projectNumber === 'No') {
      console.log('Running manual project number extraction due to poor match:', extractedData.projectNumber);
      
      // Only look for explicitly labeled project numbers (excluding job numbers)
      const manualProjectPatterns = [
        /Project\s+No\.?:\s*([a-zA-Z0-9\-_\/]+)/i,
        /Project\s+Number:\s*([a-zA-Z0-9\-_\/]+)/i,
        /Proj\s+No\.?:\s*([a-zA-Z0-9\-_\/]+)/i,
      ];
      
      for (const pattern of manualProjectPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          extractedData.projectNumber = match[1];
          console.log('Manual labeled project number extraction successful:', extractedData.projectNumber);
          break;
        }
      }
    }

    // Extract Job Number - separate from Project Number
    console.log("\n=== JOB NUMBER EXTRACTION ===");
    const jobPatterns = [
      // ONLY extract when there's explicit labeling for job numbers
      /job\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /job\s*#[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /job\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /your\s*job\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /customer\s*job\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      // Look for explicit job reference labels
      /(?:your|our)\s*(?:ref|reference)\s*(?:job)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /job\s*(?:ref|reference|code)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      // Look for patterns like "JOB-ABC123" (clear job prefixes)
      /\b(JOB[-_]?[a-zA-Z0-9]{2,15})\b/i,
    ];

    for (let i = 0; i < jobPatterns.length; i++) {
      const pattern = jobPatterns[i];
      const match = text.match(pattern);
      console.log(`Job Pattern ${i+1}/${jobPatterns.length}: ${pattern}`);
      console.log(`Job Match result:`, match);
      if (match && match[1]) {
        let jobNumber = match[1].trim();
        console.log(`Raw job match: "${jobNumber}"`);
        const isValidLength = jobNumber.length >= 2 && jobNumber.length <= 20;
        console.log(`Job validation - Length: ${jobNumber.length}, Valid: ${isValidLength}`);
        if (isValidLength) {
          console.log(`✅ JOB NUMBER FOUND: "${jobNumber}" using pattern ${i+1}`);
          extractedData.jobNumber = jobNumber;
          break;
        } else {
          console.log(`❌ Job rejected - length: ${jobNumber.length}`);
        }
      } else {
        console.log(`❌ No match for job pattern ${i+1}`);
      }
    }
    console.log(`Final job result: "${extractedData.jobNumber}"`);
    
    // Manual extraction for job numbers
    if (!extractedData.jobNumber || extractedData.jobNumber.length < 3) {
      console.log('Running manual job number extraction due to poor match:', extractedData.jobNumber);
      
      // Only look for explicitly labeled job numbers
      const manualJobPatterns = [
        /Your\s+Job\s+No\.?\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
        /Job\s+No\.?\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
        /Job\s+Number\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
      ];
      
      for (const pattern of manualJobPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          extractedData.jobNumber = match[1];
          console.log('Manual labeled job number extraction successful:', extractedData.jobNumber);
          break;
        }
      }
    }
    console.log("=== END JOB EXTRACTION ===\n");

    // Extract Delivery Order Number (DO Number) - separate field
    console.log("\n=== DO NUMBER EXTRACTION ===");
    const doPatterns = [
      // Primary DO number patterns
      /delivery\s*order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /delivery\s*order\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /d\.?\s*o\.?\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /d\.?\s*o\.?\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /do\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /do\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      /delivery\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /delivery\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
      // Look for patterns like "DO-12345" or "D2508040" (common DO formats)
      /\b(DO[-_]?[a-zA-Z0-9]{2,15})\b/i,
      /\b(D\d{7,12})\b/i, // Pattern like D2508040
      // Alternative delivery order patterns
      /del\s*order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{2,20})/i,
      /order\s*ref\.?\s*:?\s*(D[a-zA-Z0-9\-_\/]{2,19})/i,
    ];

    for (let i = 0; i < doPatterns.length; i++) {
      const pattern = doPatterns[i];
      const match = text.match(pattern);
      console.log(`DO Pattern ${i+1}/${doPatterns.length}: ${pattern}`);
      console.log(`DO Match result:`, match);
      if (match && match[1]) {
        let doNumber = match[1].trim();
        console.log(`Raw DO match: "${doNumber}"`);
        const isValidLength = doNumber.length >= 2 && doNumber.length <= 20;
        console.log(`DO validation - Length: ${doNumber.length}, Valid: ${isValidLength}`);
        if (isValidLength) {
          console.log(`✅ DO NUMBER FOUND: "${doNumber}" using pattern ${i+1}`);
          extractedData.doNumber = doNumber;
          break;
        } else {
          console.log(`❌ DO rejected - length: ${doNumber.length}`);
        }
      } else {
        console.log(`❌ No match for DO pattern ${i+1}`);
      }
    }
    console.log(`Final DO result: "${extractedData.doNumber}"`);
    
    // Manual extraction for DO numbers
    if (!extractedData.doNumber || extractedData.doNumber.length < 2) {
      console.log('Running manual DO number extraction due to poor match:', extractedData.doNumber);
      
      // Look for specific DO number patterns found in documents
      const manualDOPatterns = [
        /Delivery\s+Order\s+No\.?\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
        /D\/O\s*NO\.?\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
        /DO\s*No\.?\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
        /Delivery\s*No\.?\s*:\s*([a-zA-Z0-9\-_\/]+)/i,
        // Common format like "D2508040" at start of line or after keywords
        /(?:order|delivery).*?:\s*(D\d{7,12})/i,
        /^\s*(D\d{7,12})\s*$/m, // Standalone D followed by 7+ digits
      ];
      
      for (const pattern of manualDOPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          extractedData.doNumber = match[1].trim();
          console.log('Manual DO number extraction successful:', extractedData.doNumber);
          break;
        }
      }
    }
    console.log("=== END DO EXTRACTION ===\n");

    // Extract dates with comprehensive patterns
    const datePatterns = [
      /date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /delivery\s*date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /order\s*date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /ship\s*date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /received[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /issued[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      // Also support full month names
      /date[:\s]*(\d{1,2}[\s\/\-]\w{3,9}[\s\/\-]\d{2,4})/i,
      /delivery\s*date[:\s]*(\d{1,2}[\s\/\-]\w{3,9}[\s\/\-]\d{2,4})/i
    ];

    // Look for specific date patterns first
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        if (pattern.toString().includes('delivery')) {
          extractedData.deliveryDate = match[1].trim();
        } else if (!extractedData.date) {
          extractedData.date = match[1].trim();
        }
      }
    }

    // If no specific dates found, look for any dates in the document
    if (!extractedData.date) {
      const allDates = text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/g);
      if (allDates && allDates.length > 0) {
        extractedData.date = allDates[0];
        if (allDates.length > 1 && !extractedData.deliveryDate) {
          extractedData.deliveryDate = allDates[1];
        }
      }
    }

    // Note: Total amount field removed per user request

    // Extract items with improved logic for delivery orders and invoices
    console.log("\n=== ITEMS EXTRACTION ===");
    const lines = text.split("\n");
    const items: string[] = [];
    console.log(`Analyzing ${lines.length} lines for items...`);

    // Look for actual product/item descriptions in delivery orders
    // Strategy: Find lines that contain product descriptions after item numbers
    let inItemSection = false;
    let itemSectionStarted = false;
    
    for (let i = 0; i < lines.length; i++) {
      const cleanLine = lines[i].trim();
      
      // Skip empty lines and very short lines
      if (cleanLine.length < 3) continue;
      
      // Detect start of items section
      if (!itemSectionStarted && (
        cleanLine.toLowerCase().includes("description of product") ||
        cleanLine.toLowerCase().includes("item no.") ||
        cleanLine.toLowerCase().includes("position") ||
        cleanLine.match(/qty.*already.*deliv/i)
      )) {
        console.log(`📍 Item section detected at line ${i+1}: "${cleanLine}"`);
        itemSectionStarted = true;
        inItemSection = true;
        continue;
      }
      
      // Stop if we hit certain sections
      if (inItemSection && (
        cleanLine.toLowerCase().includes("signature") ||
        cleanLine.toLowerCase().includes("customer") ||
        cleanLine.toLowerCase().includes("received in good") ||
        cleanLine.toLowerCase().includes("terms and conditions") ||
        cleanLine.toLowerCase().includes("general terms")
      )) {
        console.log(`🛑 End of item section detected at line ${i+1}: "${cleanLine}"`);
        inItemSection = false;
        break;
      }
      
      if (inItemSection) {
        // Look for actual item descriptions - these typically:
        // 1. Don't start with numbers only (item codes start with numbers but have descriptions)
        // 2. Contain descriptive words about products
        // 3. Are not company info, addresses, or metadata
        
        // Skip lines that are clearly not items
        if (
          cleanLine.match(/^(GTIN|EAN|Customs|Country|RoHS|compliant)/i) ||
          cleanLine.match(/^[0-9\/\-()]+\s*$/) || // Item codes only
          cleanLine.match(/^(Singapore|SINGAPORE|Tel|Fax|Email|Website)/i) ||
          cleanLine.includes("@") || // Email addresses
          cleanLine.match(/^\d+\s*PC\s*\d+\s*PC/i) // Quantity only lines
        ) {
          console.log(`⏭️  SKIP: "${cleanLine}" (metadata/code line)`);
          continue;
        }
        
        // Look for lines that contain actual product descriptions
        const isProductDescription = (
          // Contains descriptive words
          /\b(conductor|disconnect|test|tb|jumper|switching|lever|locking|cover|end|plate|terminal|block|relay|switch|connector|cable|wire|module|sensor)\b/i.test(cleanLine) ||
          // Has format like "description text XX PC Y PC ZZ PC"
          /[a-zA-Z].*\d+\s*PC/i.test(cleanLine) ||
          // Contains part numbers with descriptions
          /\d+-\d+.*[a-zA-Z]{3,}/i.test(cleanLine)
        ) && 
        // But not just numbers and codes
        !/^[\d\-\s()]+$/.test(cleanLine) &&
        // Not just company/location info
        !cleanLine.match(/^(138|55|Tuas|Joo|Seng|Road|Crescent)/i);
        
        if (isProductDescription) {
          // Clean up the item description
          let item = cleanLine;
          
          // Remove item numbers at the start if present (like "10/2007-8821 (60520800) 4")
          item = item.replace(/^\d+\/[\d\-]+\s*\([^)]+\)\s*\d*\s*/g, '');
          
          // Remove trailing quantity information if it's just numbers and PC
          item = item.replace(/\s+\d+\s*PC\s*\d+\s*PC\s*\d+\s*PC.*$/i, '');
          
          // Remove leading/trailing whitespace
          item = item.trim();
          
          if (item.length > 3 && !items.includes(item)) {
            items.push(item);
            console.log(`✅ PRODUCT ITEM: "${item}" (line ${i+1})`);
          }
        } else if (cleanLine.length > 5 && cleanLine.length < 100) {
          console.log(`🔍 ANALYZE: "${cleanLine}" - Not detected as product`);
        }
      }
    }
    
    // If we didn't find items in the structured way, fall back to keyword matching
    if (items.length === 0) {
      console.log("No structured items found, trying keyword approach...");
      
      const productKeywords = [
        "conductor", "disconnect", "test", "tb", "jumper", "switching", "lever",
        "locking", "cover", "end", "plate", "terminal", "block", "relay", 
        "switch", "connector", "cable", "wire", "module", "sensor", "adapter",
        "fuse", "breaker", "contactor", "transformer"
      ];
      
      for (let i = 0; i < lines.length; i++) {
        const cleanLine = lines[i].trim();
        
        if (cleanLine.length > 5 && cleanLine.length < 150) {
          // Check for product keywords
          for (const keyword of productKeywords) {
            if (cleanLine.toLowerCase().includes(keyword.toLowerCase())) {
              // Clean up the line
              let item = cleanLine;
              item = item.replace(/^\d+\/[\d\-]+\s*\([^)]+\)\s*\d*\s*/g, '');
              item = item.replace(/\s+\d+\s*PC\s*\d+\s*PC.*$/i, '');
              item = item.trim();
              
              if (item.length > 3 && !items.includes(item)) {
                items.push(item);
                console.log(`✅ KEYWORD ITEM: "${item}" (keyword: ${keyword}, line ${i+1})`);
                break;
              }
            }
          }
        }
        
        if (items.length >= 8) break; // Limit to reasonable number
      }
    }

    extractedData.items = items.slice(0, 8);
    console.log(`Final items result: ${extractedData.items.length} items found`);
    console.log("Items:", extractedData.items);
    console.log("=== END ITEMS EXTRACTION ===\n");

    // Detect page count from text (improved for multi-page documents)
    let detectedPageCount = 1;
    
    // Look for explicit page count indicators
    const pageCountMatches = [
      text.match(/page\s+\d+\s+of\s+(\d+)/i),
      text.match(/pages?\s*:\s*(\d+)/i),
      text.match(/total\s*pages?\s*:\s*(\d+)/i),
      text.match(/(\d+)\s+pages?/i)
    ];
    
    for (const match of pageCountMatches) {
      if (match && match[1]) {
        detectedPageCount = parseInt(match[1]);
        break;
      }
    }
    
    // If still 1, check for multi-page indicators from our PDF processing
    if (detectedPageCount === 1) {
      const multiPageMatch = text.match(/Multi-page\s+Document\s+\((\d+)\s+pages\)/i);
      if (multiPageMatch && multiPageMatch[1]) {
        detectedPageCount = parseInt(multiPageMatch[1]);
      } else {
        // Count page separators as fallback
        const pageSeparators = (text.match(/---\s*Page\s*\d+---/gi) || []).length;
        if (pageSeparators > 0) {
          detectedPageCount = pageSeparators + 1;
        }
        
        // Look for form feed characters or page break indicators
        const pageBreaks = (text.match(/\f/g) || []).length;
        if (pageBreaks > 0) {
          detectedPageCount = Math.max(detectedPageCount, pageBreaks + 1);
        }
      }
    }
    
    extractedData.pageCount = detectedPageCount;

    // Extract additional comprehensive details
    const additionalData: any = {};
    
    // Extract Delivery Number (separate from project number)
    const deliveryNumberPatterns = [
      /delivery\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /delivery\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /delivery\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /del\.?\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /delivery:\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /\b(DEL[-_]?[a-zA-Z0-9]{3,15})\b/i,
      // Look for specific delivery patterns from your documents
      /delivery:\s*(\d{6,15})/i,
    ];
    
    for (const pattern of deliveryNumberPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let deliveryNumber = match[1].trim();
        if (deliveryNumber.length >= 3 && deliveryNumber.length <= 20) {
          additionalData.deliveryNumber = deliveryNumber;
          console.log('Delivery number extracted:', deliveryNumber);
          break;
        }
      }
    }
    
    // Extract Order Number (separate from PO number)
    const orderNumberPatterns = [
      /order\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /order\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /our\s*order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /customer\s*order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /sales\s*order\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /\b(ORD[-_]?[a-zA-Z0-9]{3,15})\b/i,
      // Look for specific order patterns from your documents
      /order\s*no\.:\s*([a-zA-Z0-9\-_\/]{3,20})/i,
    ];
    
    for (const pattern of orderNumberPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1] !== extractedData.poNumber) {
        let orderNumber = match[1].trim();
        if (orderNumber.length >= 3 && orderNumber.length <= 20) {
          additionalData.orderNumber = orderNumber;
          console.log('Order number extracted:', orderNumber);
          break;
        }
      }
    }
    
    // Extract addresses
    const addressPatterns = [
      /address[:\s]*([^\n\r]{10,100})/i,
      /ship\s*to[:\s]*([^\n\r]{10,100})/i,
      /bill\s*to[:\s]*([^\n\r]{10,100})/i,
      /delivery\s*address[:\s]*([^\n\r]{10,100})/i
    ];
    
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.address = match[1].trim();
        break;
      }
    }
    
    // Extract contact information
    const phoneMatch = text.match(/(?:phone|tel|mobile|contact)[:\s]*([+\-\s\d()]+)/i);
    if (phoneMatch) {
      additionalData.phone = phoneMatch[1].trim();
    }
    
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      additionalData.email = emailMatch[1];
    }
    
    // Extract invoice/document number
    const docNumberPatterns = [
      /invoice\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /document\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /receipt\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /ref\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i
    ];
    
    for (const pattern of docNumberPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1] !== extractedData.poNumber) {
        additionalData.documentNumber = match[1].trim();
        break;
      }
    }
    
    // Extract delivery details
    const deliveryTermsMatch = text.match(/(?:delivery\s*terms?|shipping\s*terms?)[:\s]*([^\n\r]{3,50})/i);
    if (deliveryTermsMatch) {
      additionalData.deliveryTerms = deliveryTermsMatch[1].trim();
    }
    
    // Extract payment terms
    const paymentTermsMatch = text.match(/(?:payment\s*terms?|terms?)[:\s]*([^\n\r]{3,50})/i);
    if (paymentTermsMatch) {
      additionalData.paymentTerms = paymentTermsMatch[1].trim();
    }
    
    // Extract currency (prioritize Singapore Dollar)
    const currencyMatch = text.match(/(SGD|S\$|USD|PHP|EUR|GBP|₱|\$|€|£)/);
    if (currencyMatch) {
      let currency = currencyMatch[1];
      // Normalize currency display
      if (currency === 'SGD') currency = 'S$';
      additionalData.currency = currency;
    } else {
      // Default to Singapore Dollar if no currency found
      additionalData.currency = 'S$';
    }
    
    // Extract quantity/units information
    const quantityMatches = text.match(/(\d+)\s*(pcs?|pieces?|units?|qty|quantity)/gi);
    if (quantityMatches && quantityMatches.length > 0) {
      additionalData.totalQuantity = quantityMatches.map(m => m.trim()).join(', ');
    }
    
    // Extract job/your reference
    const yourRefMatch = text.match(/your\s*(?:ref|reference|job\s*no)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i);
    if (yourRefMatch && yourRefMatch[1] !== extractedData.poNumber) {
      additionalData.yourReference = yourRefMatch[1].trim();
    }
    
    // Extract Customer Number (separate from PO number)
    const customerPatterns = [
      /customer\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /customer\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /cust\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /client\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i
    ];
    
    for (const pattern of customerPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.customerNumber = match[1].trim();
        break;
      }
    }
    
    // Extract Delivery Number (separate from PO number)  
    const deliveryPatterns = [
      /delivery\s*:?\s*([a-zA-Z0-9\-_\/]{6,20})/i,
      /delivery\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{6,20})/i,
      /d\/o\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /delivery\s+order\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i
    ];
    
    for (const pattern of deliveryPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.deliveryOrderNumber = match[1].trim();
        break;
      }
    }
    
    // Extract Invoice Number (separate from PO number)
    const invoicePatterns = [
      /invoice\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /invoice\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
      /inv\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /bill\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i
    ];
    
    for (const pattern of invoicePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.invoiceNumber = match[1].trim();
        break;
      }
    }
    
    // Extract Supplier Number (when document shows supplier's own reference)
    const supplierNoPatterns = [
      /supplier\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /vendor\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /supplier\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i
    ];
    
    for (const pattern of supplierNoPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].trim() !== '') {
        additionalData.supplierNumber = match[1].trim();
        break;
      }
    }
    
    
    // Extract additional business details
    
    // Extract GST/Tax Number
    const gstPatterns = [
      /gst\s*#?[:\s]*([a-zA-Z0-9\-]{8,20})/i,
      /tax\s*#?[:\s]*([a-zA-Z0-9\-]{8,20})/i,
      /vat\s*#?[:\s]*([a-zA-Z0-9\-]{8,20})/i,
      /registration\s*#?[:\s]*([a-zA-Z0-9\-]{8,20})/i
    ];
    
    for (const pattern of gstPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.gstNumber = match[1].trim();
        break;
      }
    }
    
    // Extract Company Registration Number
    const regNoPatterns = [
      /company\s*reg\.?\s*no\.?[:\s]*([a-zA-Z0-9\-]{6,20})/i,
      /reg\.?\s*no\.?[:\s]*([a-zA-Z0-9\-]{6,20})/i,
      /registration\s*no\.?[:\s]*([a-zA-Z0-9\-]{6,20})/i,
      /uen[:\s]*([a-zA-Z0-9\-]{8,15})/i
    ];
    
    for (const pattern of regNoPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.companyRegNo = match[1].trim();
        break;
      }
    }
    
    // Extract Fax Number
    const faxMatch = text.match(/fax[:\s]*([+\-\s\d()]+)/i);
    if (faxMatch) {
      additionalData.fax = faxMatch[1].trim();
    }
    
    // Extract Website
    const websiteMatch = text.match(/(www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[a-zA-Z0-9.-]+)/i);
    if (websiteMatch) {
      additionalData.website = websiteMatch[1];
    }
    
    // Extract Salesperson/Contact Person
    const salespersonPatterns = [
      /sales\s*person[:\s]*([a-zA-Z\s.]+)/i,
      /contact\s*person[:\s]*([a-zA-Z\s.]+)/i,
      /attention[:\s]*([a-zA-Z\s.]+)/i,
      /attn[:\s]*([a-zA-Z\s.]+)/i
    ];
    
    for (const pattern of salespersonPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].trim().length > 2) {
        additionalData.contactPerson = match[1].trim();
        break;
      }
    }
    
    // Extract Shipping Method
    const shippingPatterns = [
      /shipping\s*method[:\s]*([^\n\r]{3,30})/i,
      /delivery\s*method[:\s]*([^\n\r]{3,30})/i,
      /transport[:\s]*([^\n\r]{3,30})/i
    ];
    
    for (const pattern of shippingPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.shippingMethod = match[1].trim();
        break;
      }
    }
    
    // Extract Special Instructions/Notes
    const notesPatterns = [
      /notes?[:\s]*([^\n\r]{5,100})/i,
      /remarks?[:\s]*([^\n\r]{5,100})/i,
      /instructions?[:\s]*([^\n\r]{5,100})/i,
      /special\s*instructions?[:\s]*([^\n\r]{5,100})/i
    ];
    
    for (const pattern of notesPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        additionalData.specialInstructions = match[1].trim();
        break;
      }
    }
    
    // Extract Discount Information
    const discountMatch = text.match(/discount[:\s]*([0-9.%]+)/i);
    if (discountMatch) {
      additionalData.discount = discountMatch[1];
    }
    
    // Extract Subtotal
    const subtotalMatch = text.match(/sub\s*total[:\s]*(S\$|SGD|₱|\$)?([0-9,]+\.?[0-9]*)/i);
    if (subtotalMatch) {
      const currency = subtotalMatch[1] ? (subtotalMatch[1] === 'SGD' ? 'S$' : subtotalMatch[1]) : 'S$';
      additionalData.subtotal = `${currency}${parseFloat(subtotalMatch[2].replace(/,/g, '')).toLocaleString()}`;
    }
    
    // Extract Tax Amount
    const taxAmountMatch = text.match(/(?:tax|gst|vat)\s*amount[:\s]*(S\$|SGD|₱|\$)?([0-9,]+\.?[0-9]*)/i);
    if (taxAmountMatch) {
      const currency = taxAmountMatch[1] ? (taxAmountMatch[1] === 'SGD' ? 'S$' : taxAmountMatch[1]) : 'S$';
      additionalData.taxAmount = `${currency}${parseFloat(taxAmountMatch[2].replace(/,/g, '')).toLocaleString()}`;
    }
    
    // Document Format Detection and Universal Patterns
    const formatIndicators = [];
    
    // Detect document type/format
    if (text.match(/delivery\s*order/i)) formatIndicators.push("Delivery Order");
    if (text.match(/purchase\s*order/i)) formatIndicators.push("Purchase Order");
    if (text.match(/invoice/i)) formatIndicators.push("Invoice");
    if (text.match(/receipt/i)) formatIndicators.push("Receipt");
    if (text.match(/quotation/i)) formatIndicators.push("Quotation");
    if (text.match(/packing\s*list/i)) formatIndicators.push("Packing List");
    if (text.match(/shipment/i)) formatIndicators.push("Shipment");
    if (text.match(/manifest/i)) formatIndicators.push("Manifest");
    
    additionalData.documentType = formatIndicators.join(", ") || "Document";
    
    // Universal fallback patterns for any format
    if (!extractedData.supplier) {
      // Look for any company-like entity in first 10 lines
      const firstLines = text.split('\n').slice(0, 10).join('\n');
      const anyCompanyMatch = firstLines.match(/([A-Z][A-Za-z\s&.,]{5,50}(?:Ltd|Inc|Corp|LLC|Co|Pte|Pvt))/i);
      if (anyCompanyMatch) {
        extractedData.supplier = anyCompanyMatch[1].trim();
        console.log('Universal company fallback extraction:', extractedData.supplier);
      }
    }
    
    // Universal number extraction for any unidentified key numbers
    const allNumbers = text.match(/\b\d{6,12}\b/g);
    if (allNumbers && allNumbers.length > 0) {
      additionalData.extractedNumbers = allNumbers.slice(0, 5).join(', ');
    }
    
    // Universal code extraction (any alphanumeric codes)
    const allCodes = text.match(/\b[A-Z]{2,4}[-_]?[A-Z0-9]{3,10}\b/g);
    if (allCodes && allCodes.length > 0) {
      additionalData.extractedCodes = allCodes.slice(0, 5).join(', ');
    }
    
    // Universal date extraction (any date formats)
    const allDates = text.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g);
    if (allDates && allDates.length > 0) {
      additionalData.allDatesFound = allDates.slice(0, 3).join(', ');
    }
    
    // Extract any monetary amounts found
    const allAmounts = text.match(/(S\$|SGD|[₱$€£¥])\s*[0-9,]+\.?[0-9]*/g);
    if (allAmounts && allAmounts.length > 0) {
      // Normalize SGD to S$ in the found amounts
      const normalizedAmounts = allAmounts.map(amount => amount.replace('SGD', 'S$'));
      additionalData.allAmountsFound = normalizedAmounts.slice(0, 3).join(', ');
    }
    
    // Merge additional data with extracted data
    Object.assign(extractedData, additionalData);

    console.log("Extracted data with format detection:", extractedData);
  } catch (error) {
    console.error("Error during data extraction:", error);
    // Return the data we have so far, even if extraction failed
  }

  return extractedData;
};

// Process image with Tesseract OCR
const processImageWithTesseract = async (filePath: string, fileName: string): Promise<any> => {
  try {
    console.log("Processing image with Tesseract OCR:", fileName);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Check file size
    const stats = fs.statSync(filePath);
    console.log("File size:", stats.size, "bytes");
    
    if (stats.size === 0) {
      throw new Error("File is empty");
    }
    
    // Test if Tesseract is available
    console.log("Checking Tesseract availability...");
    try {
      // Create a minimal Tesseract worker to test availability
      const worker = await Tesseract.createWorker();
      await worker.terminate();
      console.log("Tesseract is available and working");
    } catch (tesseractAvailabilityError) {
      console.error("Tesseract is not available:", tesseractAvailabilityError);
      throw new Error("Tesseract OCR engine is not available on this system. Please install Tesseract-OCR or use PDF processing instead.");
    }
    
    // Use Tesseract OCR to extract text from the image
    console.log("Starting Tesseract OCR processing...");
    const result = await Tesseract.recognize(filePath, "eng");
    
    const extractedText = result.data.text;
    
    console.log("Tesseract OCR completed successfully");
    console.log("Extracted text length:", extractedText.length);
    console.log("First 500 characters:", extractedText.substring(0, 500));
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("No text could be extracted from the image");
    }
    
    // Extract structured data from the text using our pattern matching
    const extractedData = extractDataFromText(extractedText);
    
    return {
      ...extractedData,
      pageCount: 1,
      documentType: "image_ocr",
      confidence: 0.85, // Default confidence for Tesseract
      rawData: {
        originalText: extractedText,
        ocrMethod: "tesseract",
        fileName,
        fileSize: stats.size
      }
    };
    
  } catch (error) {
    console.error("Tesseract OCR processing error:", error);
    throw new Error(`Failed to process image with Tesseract: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Process PDF with Google Vision AI API (reads PDF as image data)
const processPDFWithGoogleVision = async (filePath: string, fileName: string): Promise<any> => {
  let visionService: GoogleVisionDocumentService | null = null;
  
  try {
    console.log("Processing PDF with Google Vision AI:", fileName);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Check file size
    const stats = fs.statSync(filePath);
    console.log("File size:", stats.size, "bytes");
    
    if (stats.size === 0) {
      throw new Error("File is empty");
    }
    
    // Create Google Vision service instance
    visionService = createGoogleVisionService();
    
    // Process PDF using Google Vision AI (it can handle PDF directly)
    console.log("Starting Google Vision AI PDF processing...");
    const extractedData = await visionService.processDocument(filePath, fileName);
    
    console.log("Google Vision AI PDF processing completed successfully");
    console.log("Extracted data:", extractedData);
    
    return {
      ...extractedData,
      documentType: "pdf_vision_ai"
    };
    
  } catch (error) {
    console.error("Google Vision AI PDF processing error:", error);
    
    // Fallback to basic PDF text extraction if Google Vision fails
    console.log("Google Vision AI processing failed, using basic PDF fallback");
    return await processBasicPDF(filePath, fileName);
  }
};

// Fallback PDF processing for when Klippa fails
const processBasicPDF = async (filePath: string, fileName: string): Promise<any> => {
  try {
    console.log("Using basic PDF text extraction as fallback");
    
    // Read the PDF file
    const buffer = fs.readFileSync(filePath);
    
    // Check if it's a valid PDF
    const isPDF = buffer.toString('ascii', 0, 4) === '%PDF';
    if (!isPDF) {
      throw new Error("File is not a valid PDF document");
    }
    
    // Use PDF.js for basic text extraction
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    
    // Convert Buffer to Uint8Array for PDF.js compatibility
    const uint8Array = new Uint8Array(buffer);
    
    const pdfDoc = await pdfjsLib.getDocument({
      data: uint8Array,
      standardFontDataUrl: null,
      cMapUrl: null,
      cMapPacked: false,
    }).promise;
    
    const numPages = pdfDoc.numPages;
    let fullText = "";
    
    // Extract text from all pages
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      let pageText = "";
      for (const item of textContent.items) {
        if ('str' in item) {
          pageText += item.str + " ";
        }
      }
      
      if (pageText.trim()) {
        fullText += pageText.trim() + "\n";
      }
    }
    
    // Use basic pattern extraction on the text
    const basicData = extractDataFromText(fullText);
    
    return {
      ...basicData,
      pageCount: numPages,
      documentType: "pdf_fallback",
      confidence: 0.5,
      rawData: {
        fallback: true,
        method: "basic_pdf_extraction",
        extractedText: fullText.substring(0, 1000) // First 1000 chars for debugging
      }
    };
    
  } catch (error) {
    console.error("Basic PDF processing failed:", error);
    throw error;
  }
};

// Note: Document storage is now handled by SQLite database

// Main processing endpoint
export const processDocument: RequestHandler = async (req, res) => {
  console.log("🚀 processDocument endpoint called");
  console.log("Request headers:", req.headers);
  console.log("Request method:", req.method);
  
  try {
    upload.single("document")(req, res, async (err) => {
      console.log("📁 Multer upload middleware called");
      
      if (err) {
        console.error("File upload error:", err);
        return res.status(400).json({ 
          error: err.message,
          details: "Multer file upload failed"
        });
      }

      console.log("📋 Checking for uploaded file...");
      if (!req.file) {
        console.error("No file uploaded - req.file is null/undefined");
        console.log("Request body:", req.body);
        return res.status(400).json({ 
          error: "No file uploaded",
          details: "req.file is missing - check form field name should be 'document'"
        });
      }
      
      console.log("✅ File upload successful:", {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });

      console.log("File uploaded successfully:", {
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      });

      const filePath = req.file.path;
      const fileType = req.file.mimetype;
      let extractedText = "";

      try {
        let extractedData;
        
        console.log(`Starting processing for file type: ${fileType}`);
        console.log(`File path: ${filePath}`);
        console.log(`File exists: ${fs.existsSync(filePath)}`);
        
        // Check if this is pre-extracted PDF text (multer puts form fields in req.body)
        console.log("Request body keys:", Object.keys(req.body || {}));
        console.log("Has extractedText:", !!req.body?.extractedText);
        console.log("Has pageCount:", !!req.body?.pageCount);
        
        if (req.body?.extractedText && req.body?.pageCount) {
          console.log("Processing pre-extracted PDF text from client-side PDF.js + Tesseract");
          const extractedText = req.body.extractedText;
          const pageCount = parseInt(req.body.pageCount, 10);
          
          // Split multi-page PDF into separate documents based on page separators
          console.log("Attempting to split multi-page PDF...");
          const multipleDocuments = splitMultiPagePDF(extractedText, req.file.originalname, req.file.size, pageCount);
          console.log(`Split result: ${multipleDocuments.length} documents found`);
          
          if (multipleDocuments.length > 1) {
            console.log(`Found ${multipleDocuments.length} separate documents in the PDF`);
            
            // Process all documents and return array
            const processedDocuments = [];
            for (let i = 0; i < multipleDocuments.length; i++) {
              const docData = multipleDocuments[i];
              const extractedData = await extractDataFromText(docData.text);
              
              const result = {
                id: (Date.now() + i).toString(),
                originalName: docData.fileName,
                renamedName: `${extractedData.supplier || "Unknown"}_${extractedData.poNumber || "Unknown"}_${docData.fileName}`,
                type: req.file.mimetype,
                fileSize: req.file.size,
                status: "Processed" as const,
                supplier: extractedData.supplier || "Not found",
                poNumber: extractedData.poNumber || "Not found", 
                projectNumber: extractedData.projectNumber || "Not found",
                jobNumber: extractedData.jobNumber || "Not found",
                doNumber: extractedData.doNumber || "Not found",
                date: extractedData.date || "Not found",
                extractedData: {
                  ...extractedData,
                  pageCount: docData.pageNumber,
                  documentType: "pdf_tesseract",
                  confidence: 0.85,
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
              
              // Save each document to database
              try {
                saveDocument(result);
                console.log(`Document ${i + 1} saved to database:`, result.id);
              } catch (dbError) {
                console.error(`Database save failed for document ${i + 1}:`, dbError);
              }
              
              processedDocuments.push(result);
            }
            
            // Return multiple documents result
            return res.json({ 
              results: processedDocuments, 
              processedCount: processedDocuments.length,
              multiDocument: true 
            });
          } else {
            // Single document processing (existing logic)
            extractedData = await extractDataFromText(extractedText);
            extractedData.pageCount = pageCount;
            extractedData.documentType = "pdf_tesseract";
            extractedData.confidence = 0.85;
            extractedData.rawData = {
              originalText: extractedText,
              ocrMethod: "pdf.js + tesseract",
              fileName: req.file.originalname,
              fileSize: req.file.size,
              pageCount: pageCount
            };
            console.log("Pre-extracted PDF text processing completed successfully");
          }
        }
        // Process based on file type - images use Tesseract, PDFs use Google Vision AI
        else if (fileType.startsWith("image/")) {
          console.log("Processing as image file with Tesseract");
          try {
            extractedData = await processImageWithTesseract(filePath, req.file.originalname);
            console.log("Tesseract processing completed successfully");
          } catch (tesseractError) {
            console.error("Tesseract processing failed:", tesseractError);
            
            // Fallback: Return a basic response indicating OCR is not available
            console.log("Using fallback processing for image");
            extractedData = {
              supplier: "OCR not available",
              poNumber: "OCR not available", 
              projectNumber: "OCR not available",
              date: "OCR not available",
              deliveryDate: "",
              totalAmount: "",
              items: [],
              pageCount: 1,
              documentType: "image_fallback",
              confidence: 0,
              rawData: {
                fallback: true,
                error: tesseractError instanceof Error ? tesseractError.message : 'Unknown tesseract error',
                fileName: req.file.originalname,
                fileSize: req.file.size,
                message: "Tesseract OCR engine is not available. Please ensure Tesseract is installed or convert image to PDF format."
              }
            };
          }
        } else if (fileType === "application/pdf") {
          console.log("Processing as PDF file with Google Vision AI");
          try {
            extractedData = await processPDFWithGoogleVision(filePath, req.file.originalname);
            console.log("Google Vision AI processing completed successfully");
          } catch (visionError) {
            console.error("Google Vision AI processing failed:", visionError);
            throw new Error(`Google Vision AI failed: ${visionError instanceof Error ? visionError.message : 'Unknown vision error'}`);
          }
        } else {
          throw new Error(`Unsupported file type: ${fileType}`);
        }
        
        console.log("Document processing completed:", extractedData);

        // Generate a meaningful filename first
        const originalName = req.file.originalname;
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        
        let supplierName = extractedData.supplier || "Unknown";
        let poNumber = extractedData.poNumber || "Unknown";
        
        const renamedName = `${supplierName}_${poNumber}_${baseName}${extension}`;

        // Clean up uploaded file after processing
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("Uploaded file cleaned up after processing");
        }

        const result = {
          id: Date.now().toString(),
          originalName,
          renamedName,
          type: fileType,
          fileSize: req.file.size,
          status: "Processed" as const,
          supplier: extractedData.supplier || "Not found",
          poNumber: extractedData.poNumber || "Not found",
          projectNumber: extractedData.projectNumber || "Not found",
          jobNumber: extractedData.jobNumber || "Not found",
          doNumber: extractedData.doNumber || "Not found",
          date: extractedData.date || "Not found",
          extractedData,
          filePath: null, // CSV download doesn't need file path
        };

        console.log("Processing completed successfully, saving to database");
        
        // Save to database
        try {
          saveDocument(result);
          console.log("Document saved to database:", result.id);
        } catch (dbError) {
          console.error("Database save failed:", dbError);
          // Continue without failing the entire request
          console.log("Continuing without database save - returning result anyway");
        }
        
        res.json(result);
      } catch (processingError) {
        console.error("Processing error:", processingError);
        // Clean up file on error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("Uploaded file cleaned up after error");
        }
        throw processingError;
      }
    });
  } catch (error) {
    console.error("❌ Document processing endpoint error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    res.status(500).json({ 
      error: "Failed to process document", 
      details: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString()
    });
  }
};

// Process multiple documents
export const processMultipleDocuments: RequestHandler = async (req, res) => {
  try {
    upload.array("documents", 10)(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const results = [];
      const files = Array.isArray(req.files) ? req.files : [req.files];

      for (const file of files) {
        try {
            const filePath = file.path as string;
            const fileType = file.mimetype as string;
          let extractedText = "";

          // Process based on file type - images use Tesseract, PDFs use Google Vision AI
          let extractedData;
          if (fileType.startsWith("image/")) {
            console.log("Processing image file with Tesseract:", file.originalname);
            extractedData = await processImageWithTesseract(filePath, file.originalname as string);
          } else if (fileType === "application/pdf") {
            console.log("Processing PDF file with Google Vision AI:", file.originalname);
            extractedData = await processPDFWithGoogleVision(filePath, file.originalname as string);
          } else {
            throw new Error(`Unsupported file type: ${fileType}`);
          }

          // Generate filename
          const originalName = file.originalname as string;
          const extension = path.extname(originalName);
          const baseName = path.basename(originalName, extension);
          
          let supplierName = extractedData.supplier || "Unknown";
          let poNumber = extractedData.poNumber || "Unknown";
          
          const renamedName = `${supplierName}_${poNumber}_${baseName}${extension}`;

          const result = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            originalName,
            renamedName,
            type: fileType,
            fileSize: file.size,
            status: "Processed",
            supplier: extractedData.supplier || "Not found",
            poNumber: extractedData.poNumber || "Not found",
            projectNumber: extractedData.projectNumber || "Not found",
            jobNumber: extractedData.jobNumber || "Not found",
            doNumber: extractedData.doNumber || "Not found",
            date: extractedData.date || "Not found",
            extractedData,
            filePath: null, // CSV download doesn't need file path
          };

          // Save to database
          saveDocument(result);
          
          results.push(result);

          // Clean up uploaded file
          fs.unlinkSync(filePath);
        } catch (fileError) {
          console.error(`Error processing file ${file.originalname}:`, fileError);
          // Continue with other files
        }
      }

      res.json({ results, processedCount: results.length });
    });
  } catch (error) {
    console.error("Multiple document processing error:", error);
    res.status(500).json({ 
      error: "Failed to process documents",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
