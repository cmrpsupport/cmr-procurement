import { RequestHandler } from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { saveDocument } from "../database";
// Google Vision service removed - using Tesseract + PDF.js instead

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
  console.log(`Full text length: ${fullText.length}`);
  console.log(`First 500 chars: ${fullText.substring(0, 500)}`);
  
  // Split by page separators - be more flexible with the pattern
  const pages = fullText.split(/=== PAGE \d+ START ===/);
  console.log(`Split result: ${pages.length} parts found`);
  
  // If no pages found with the pattern, try alternative splitting
  if (pages.length <= 1) {
    console.log("No page separators found, trying alternative splitting...");
    // Try splitting by page numbers or other indicators
    const alternativePages = fullText.split(/\n\s*=== PAGE \d+ START ===\s*\n/);
    if (alternativePages.length > 1) {
      pages.length = 0;
      pages.push(...alternativePages);
      console.log(`Alternative split result: ${pages.length} parts found`);
    }
  }
  
  pages.forEach((part, idx) => {
    console.log(`Part ${idx}: length=${part.length}, first 100 chars="${part.substring(0, 100)}"`);
  });
  const documents = [];
  
  for (let i = 0; i < pages.length; i++) {
    let pageText = pages[i].trim();

    // Clean up page text by removing END markers
    pageText = pageText.replace(/=== PAGE \d+ END ===/g, '').trim();

    if (pageText.length < 50) {
      console.log(`Skipping page ${i + 1} - too short (${pageText.length} chars)`);
      continue; // Skip very short pages
    }
    
    console.log(`\n--- Processing Page ${i + 1} ---`);
    console.log(`Page text length: ${pageText.length}`);
    console.log(`First 200 chars: ${pageText.substring(0, 200)}`);
    
    // Detect if this page contains a delivery order/invoice - be more inclusive
    const isDeliveryDocument = (
      /delivery\s*order/i.test(pageText) ||
      /d\s*[oO]\s*[\.:]?\s*no/i.test(pageText) ||  // DO number patterns
      /invoice/i.test(pageText) ||
      /delivery/i.test(pageText) ||
      /purchase\s*order/i.test(pageText) ||
      /quotation/i.test(pageText) ||
      /supplier/i.test(pageText) ||  // Pages with supplier info
      /po\s*number/i.test(pageText) ||  // PO number patterns
      /order\s*no/i.test(pageText) ||
      /your\s*po\s*no/i.test(pageText) ||  // "Your PO No" patterns
      /p\s*\/?\s*o\s*ref/i.test(pageText) ||  // "P/O REF" patterns
      /sold\s*to/i.test(pageText) ||  // "SOLD TO" patterns
      /terminal\s*block/i.test(pageText) ||  // Product content indicates delivery
      /quantity/i.test(pageText) ||  // Quantity fields indicate delivery
      /ribbon/i.test(pageText) ||  // Product items
      /wago/i.test(pageText) ||  // WAGO company name
      /senconix/i.test(pageText) ||  // SENCONIX company name
      /wah\s*lei/i.test(pageText) ||  // WAH LEI company name
      /scl/i.test(pageText) ||  // SCL company name
      /cmr/i.test(pageText) ||  // CMR company name
      /customer/i.test(pageText) ||  // Customer information
      /address/i.test(pageText) ||  // Address information
      /tel/i.test(pageText) ||  // Phone numbers
      /email/i.test(pageText) ||  // Email addresses
      pageText.length > 200  // If page has substantial content, include it (lowered threshold)
    );
    
    // Detect company/supplier patterns on this page - very flexible for OCR issues
    const companyPatterns = [
      // WAGO patterns - multiple variations - make even more flexible
      /WAGO[\s\w]*?[Ee]\s*lectronic/i,  // Very flexible WAGO pattern - just need WAGO + Electronic
      /WAGO\s+E\s+lectronic\s+P\s+te\s+L\s+td/i,  // OCR spaced pattern
      /WAGO.*?electronic/i,  // Even simpler WAGO pattern
      /13B?\s+J\s*oo\s+S\s*eng\s+R\s*oad/i,  // WAGO address pattern

      // SENCONIX patterns - multiple variations
      /SENCONIX/i,  // Simple SENCONIX pattern
      /(sen\s*conix\.com)/i,  // Alternative SENCONIX detection from email
      /enquiry@sen\s*conix\.com/i,  // Email pattern

      // WAH LEI patterns - multiple variations
      /WAH\s+LEI[\s\w]*?INDUSTRIAL/i,  // Flexible WAH LEI pattern - just need WAH LEI + INDUSTRIAL
      /SUPPLIER:\s*WAH\s+LEI/i,  // Direct supplier line detection
      /WAH\s+LE[I!]\s+INDUSTRIAL\s+SUPPLY/i,  // Handle OCR ! vs I confusion

      // SCL patterns - multiple variations
      /SCL[\s\w]*?System[\s\w]*?Enterprise/i,  // Flexible SCL pattern - just need SCL + System + Enterprise
      /SCL\s+S\s*ystem\s+E\s*nterprise/i,  // OCR spaced pattern

      // Generic company patterns to catch anything we missed
      /[A-Z]{2,}\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s+Pte\s+Ltd/i,  // Generic "XXX YYY ZZZ Pte Ltd" pattern
    ];
    
    let detectedCompany = null;
    for (const pattern of companyPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        detectedCompany = match[0].trim();  // Use match[0] since not all patterns have capture groups

        // Clean up OCR spacing issues
        detectedCompany = detectedCompany
          .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
          .replace(/([a-z])\s+([A-Z])/g, '$1$2')  // Remove spaces before capitals (e.g., "P te" -> "Pte")
          .replace(/\s+([.,])/g, '$1')  // Remove spaces before punctuation
          .trim();

        // Standardize company names based on detected patterns
        const lower = detectedCompany.toLowerCase();
        if (lower.includes('wago')) {
          detectedCompany = 'WAGO Electronic Pte Ltd';
        } else if (lower.includes('senconix')) {
          detectedCompany = 'SENCONIX PTE LTD';
        } else if (lower.includes('wah') && lower.includes('lei')) {
          detectedCompany = 'WAH LEI INDUSTRIAL SUPPLY CO. PTE. LTD.';
        } else if (lower.includes('scl')) {
          detectedCompany = 'SCL System Enterprise Pte Ltd';
        }

        console.log(`Detected company: ${detectedCompany}`);
        break;
      }
    }

    console.log(`Page ${i + 1} analysis: isDeliveryDocument=${isDeliveryDocument}, detectedCompany="${detectedCompany}"`);

    // Include page if it's either a delivery document OR has a detected company OR has substantial content
    if (isDeliveryDocument || detectedCompany || pageText.length > 300) {
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
      
      console.log(`✅ Added document: ${documentFileName} (Company: ${detectedCompany || 'None detected'}, Length: ${pageText.length})`);
    } else {
      console.log(`❌ Skipped page ${i + 1} - Not a delivery document or no company detected`);
      console.log(`  - Is delivery document: ${isDeliveryDocument}`);
      console.log(`  - Detected company: ${detectedCompany}`);
      console.log(`  - Text length: ${pageText.length}`);
    }
  }
  
    console.log(`\n=== SPLIT RESULT: ${documents.length} documents found ===`);
    documents.forEach((doc, idx) => {
      console.log(`${idx + 1}. ${doc.fileName} - ${doc.detectedCompany}`);
      console.log(`   Text preview: ${doc.text.substring(0, 200)}...`);
    });
    console.log("=== END SPLITTING ===\n");
    
    // If no documents found, create at least one document from the full text
    if (documents.length === 0) {
      console.log("No documents found in splitting, creating single document from full text");
      const baseName = originalFileName.replace(/\.(pdf|PDF)$/, '');
      documents.push({
        text: fullText,
        fileName: `${baseName}_Page1.pdf`,
        pageNumber: 1,
        detectedCompany: null,
        originalIndex: 0
      });
    }
    
    return documents;
};

// Helper function to add spacing to concatenated OCR text
const addSpacingToText = (text: string): string => {
  console.log("\n=== ADDING SPACING TO OCR TEXT ===");
  console.log("Original text length:", text.length);
  console.log("First 200 chars:", text.substring(0, 200));
  
  let spacedText = text;
  
  // Add spaces before capital letters that follow lowercase letters or numbers
  spacedText = spacedText.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  
  // Add spaces before numbers that follow letters
  spacedText = spacedText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  
  // Add spaces after numbers that are followed by letters
  spacedText = spacedText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  
  // Add spaces around specific patterns
  spacedText = spacedText.replace(/([a-z])(Ltd|Inc|Corp|Co|PTE)/gi, '$1 $2');
  spacedText = spacedText.replace(/(Electronic|Systems|Enterprise|Supply|Industrial)(Pte|Ltd|Inc|Corp)/gi, '$1 $2');
  
  // Add spaces before common address/contact patterns
  spacedText = spacedText.replace(/([a-z])(Tel|Fax|Email|Website|Singapore|Road|Street|Drive|Crescent)([^a-z])/gi, '$1 $2$3');
  
  // Add spaces around colons for field labels
  spacedText = spacedText.replace(/([a-zA-Z]):([a-zA-Z0-9])/g, '$1: $2');
  
  // Add spaces after periods in abbreviations
  spacedText = spacedText.replace(/([A-Z])\.([A-Z])/g, '$1. $2');
  
  // Fix specific concatenated patterns from your OCR
  spacedText = spacedText.replace(/WAGOElectronicPteLtd/gi, 'WAGO Electronic Pte Ltd');
  spacedText = spacedText.replace(/SENOCONIXPteLtd/gi, 'SENCONIX Pte Ltd');
  spacedText = spacedText.replace(/SCLSystemEnterprisePteLtd/gi, 'SCL System Enterprise Pte Ltd');
  spacedText = spacedText.replace(/WAHLEIIndustrialSupplyCo/gi, 'WAH LEI Industrial Supply Co');
  spacedText = spacedText.replace(/Yourorderno\./gi, 'Your order no.');
  spacedText = spacedText.replace(/DeliveryOrder/gi, 'Delivery Order');
  
  // Clean up multiple spaces
  spacedText = spacedText.replace(/\s{2,}/g, ' ');
  
  console.log("After spacing - length:", spacedText.length);
  console.log("After spacing - first 200 chars:", spacedText.substring(0, 200));
  console.log("=== SPACING COMPLETE ===\n");
  
  return spacedText;
};

// Helper function to correct common OCR mistakes
const correctOCRText = (text: string): string => {
  console.log("\n=== OCR TEXT CORRECTION STARTING ===");
  console.log("Original text length:", text.length);
  console.log("First 500 chars:", text.substring(0, 500));
  
  // First add spacing to concatenated text
  text = addSpacingToText(text);
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
    
    // Number confusions - DISABLED AGGRESSIVE PATTERNS THAT BREAK PO NUMBERS
    // [/O(\d)/g, '0$1'], // O confused with 0 - DISABLED: can break PO numbers
    // [/(\d)O/g, '$10'], // O confused with 0 - DISABLED: can break PO numbers
    // [/l(\d)/g, '1$1'], // l confused with 1 - DISABLED: can break text
    // [/(\d)l/g, '$11'], // l confused with 1 - DISABLED: can break text
    [/Q(?=\s|$)/g, 'O'], // Q -> O at word boundaries
    [/8(?=\s+[A-Z])/g, 'B'], // 8 -> B before capital letters
    // [/5(?=\s+[A-Z])/g, 'S'], // 5 -> S before capital letters - DISABLED: BREAKS P055918
  ];
  
  let correctedText = text;
  corrections.forEach(([pattern, replacement]) => {
    correctedText = correctedText.replace(pattern, replacement);
  });
  
  return correctedText;
};

// ULTRA-SIMPLE EXTRACTION - JUST GRAB ANYTHING
const extractDataFromText = (text: string) => {
  console.log("=== ULTRA-SIMPLE EXTRACTION STARTING ===");
  console.log("Text length:", text.length);
  
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
    // Get first line as supplier
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    if (lines.length > 0) {
      result.supplier = lines[0].trim();
      console.log("SUPPLIER:", result.supplier);
    }
    
    // Find any word with letters and numbers
    const words = text.split(/\s+/).filter(w => w.length > 3);
    for (const word of words.slice(0, 50)) { // Check first 50 words
      if (/^[A-Z0-9]{4,15}$/.test(word)) {
        result.poNumber = word;
        console.log("PO/REF:", word);
        break;
      }
    }
    
    // Find any date
    const dateMatch = text.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/);
    if (dateMatch) {
      result.date = dateMatch[0];
      console.log("DATE:", dateMatch[0]);
    }
    
    // Find D + numbers
    const doMatch = text.match(/\bD\d{4,10}\b/i);
    if (doMatch) {
      result.doNumber = doMatch[0];
      console.log("DO:", doMatch[0]);
    }

  } catch (error) {
    console.error("Simple extraction error:", error);
  }

  console.log("=== SIMPLE EXTRACTION DONE ===");
  console.log("Results:", result);
  return result;
};

const processImageWithTesseract = async (filePath: string, fileName: string): Promise<any> => {
  try {
    console.log("Processing image with Tesseract OCR:", fileName);
      /(SCL\s*System\s*Enterprise)/i,  // Shorter SCL pattern
      
      // Enhanced patterns for better detection
      /^([A-Z][A-Za-z\s&.,]*WAGO[A-Za-z\s&.,]*)/im,  // Lines starting with WAGO
      /^([A-Z][A-Za-z\s&.,]*SENCONIX[A-Za-z\s&.,]*)/im,  // Lines starting with SENCONIX
      /^([A-Z][A-Za-z\s&.,]*WAH\s*LEI[A-Za-z\s&.,]*)/im,  // Lines starting with WAH LEI
      /^([A-Z][A-Za-z\s&.,]*SCL[A-Za-z\s&.,]*)/im,  // Lines starting with SCL
      
      // More flexible patterns to catch any company name
      /^([A-Z][A-Za-z\s&.,]{5,50}(?:Pte\s+Ltd|Ltd|Inc|Corp|LLC|Co))/im,  // Any company with Ltd/Inc/etc
      /^([A-Z][A-Za-z\s&.,]{5,50}(?:Electronic|Electronics|Industries|Trading|Services))/im,  // Any company with business type
      /^([A-Z][A-Za-z\s&.,]{5,50})/im,  // Any capitalized company name at start of line
      
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
    console.log("Text being searched for supplier:", text.substring(0, 1000));
    
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
        supplier = supplier.replace(/([a-z])\s+([A-Z])/g, '$1$2');  // Remove spaces before capitals (e.g., "P te" -> "Pte")
        supplier = supplier.replace(/\s+([.,])/g, '$1');  // Remove spaces before punctuation
        supplier = supplier.replace(/WAGQ/g, 'WAGO'); // Fix common OCR error
        supplier = supplier.replace(/WAG[OQ0]/g, 'WAGO'); // Fix OCR variations
        supplier = supplier.replace(/Electronic\s+Pte\s+Ltd.*$/i, 'Electronic Pte Ltd'); // Clean trailing text
        supplier = supplier.replace(/\s*-\s*[^-]*$/, ''); // Remove trailing descriptions after dash

        // Fix common OCR issues with standardized company names
        if (supplier.toLowerCase().includes('wago') && supplier.toLowerCase().includes('lectronic')) {
          supplier = 'WAGO Electronic Pte Ltd';
        } else if (supplier.toLowerCase().includes('senconix') || supplier.toLowerCase().includes('sen conix')) {
          supplier = 'SENCONIX PTE LTD';
        } else if (supplier.toLowerCase().includes('wah lei')) {
          supplier = 'WAH LEI INDUSTRIAL SUPPLY CO. PTE. LTD.';
        } else if (supplier.toLowerCase().includes('scl system')) {
          supplier = 'SCL System Enterprise Pte Ltd';
        }
        
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
        
        // More lenient validation for supplier names
        const isValidLength = supplier.length >= 2 && supplier.length <= 150;
        const hasLetters = /[a-zA-Z]/.test(supplier); // Must contain at least one letter
        const isNotGeneric = !/^(company|supplier|vendor|business|organization|delivery|order|page|date|number)$/i.test(supplier); // Not generic terms
        const hasCompanyIndicators = /(ltd|inc|corp|llc|co|pte|electronic|trading|services|supply|industrial|wago|senconix|wah|lei|scl)/i.test(supplier); // Has company indicators
        
        console.log(`Supplier validation - Length: ${supplier.length}, Has letters: ${hasLetters}, Not generic: ${isNotGeneric}, Has company indicators: ${hasCompanyIndicators}`);
        
        // Be more lenient - accept if it has letters and is not obviously generic
        if (isValidLength && hasLetters && (isNotGeneric || hasCompanyIndicators || supplier.length > 10)) {
          console.log(`✅ SUPPLIER FOUND: "${supplier}" using pattern ${i+1}`);
          extractedData.supplier = supplier;
          break;
        } else {
          console.log(`❌ Supplier rejected - length: ${supplier.length}, has letters: ${hasLetters}, not generic: ${isNotGeneric}, has company indicators: ${hasCompanyIndicators}`);
        }
      } else {
        console.log(`❌ No match for pattern ${i+1}`);
      }
    }
    console.log(`Final supplier result: "${extractedData.supplier}"`);
    console.log("=== END SUPPLIER EXTRACTION ===\n");
    
    // Manual extraction for supplier if patterns fail
    if (!extractedData.supplier || extractedData.supplier.length < 5) {
      console.log("=== FALLBACK SUPPLIER EXTRACTION ===");
      
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
        } else {
          // Try to find any capitalized company name in the first few lines
          const lines = text.split('\n').slice(0, 10); // Check first 10 lines
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.length > 5 && trimmedLine.length < 100 && /^[A-Z]/.test(trimmedLine)) {
              // Check if it looks like a company name
              if (/(ltd|inc|corp|llc|co|pte|electronic|trading|services|supply|industrial)/i.test(trimmedLine)) {
                extractedData.supplier = trimmedLine;
                console.log('Fallback company extraction from line:', extractedData.supplier);
                break;
              }
            }
          }
        }
      }
    }

    // Extract PO Number with patterns specific to your OCR output - based on actual OCR text
    const poPatterns = [
      // EXACT patterns from OCR logs - extract everything after the colon
      /Y\s*our\s*order\s*no\.\s*:\s*(P\s*\d+\w*)/i, // "Y our order no.: P 055903" (WAGO)
      /Y\s*our\s*PO\s*N\s*o\s*:\s*(P\s*\d+\w*)/i, // "Y our PO N o: P 05591B" (SENCONIX)
      /P\s*\/\s*O\s*REF\s*:\s*(PO[R0]?\s*[5R]?\s*\d+)/i, // "P/O REF : PO55919" or "POR 5919" (WAH LEI OCR variations)
      /PO\s*Number\s*:\s*(P\s*\d+\w*)/i, // "PO Number: P 055922" (SCL)

      // More flexible patterns
      /Your\s*order\s*no\.\s*:\s*(P[O0]?\s*\d+\w*)/i, // Less spaced version
      /Your\s*PO\s*No?\s*:\s*(P[O0]?\s*\d+\w*)/i, // Less spaced version
      /P\s*\/?\s*O\s*REF\s*:\s*(PO[R0]?\s*\d+)/i, // Less spaced version
      /PO\s*Number\s*:\s*(P[O0]?\s*\d+\w*)/i, // Less spaced version

      // Even more flexible patterns
      /order\s*no\.\s*:\s*(P[O0]?\s*\d+\w*)/i, // Generic order no
      /PO\s*No?\s*:\s*(P[O0]?\s*\d+\w*)/i, // Generic PO No
      /REF\s*:\s*(PO[R0]?\s*\d+)/i, // Generic REF
      /your\s*order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /your\s*po\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      /order\s*no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      
      // Enhanced patterns for better detection
      /Your\s*order\s*no\.?\s*:?\s*([A-Z0-9\s]{3,20})/i,  // More flexible order number
      /Your\s*PO\s*No\.?\s*:?\s*([A-Z0-9\s]{3,20})/i,  // More flexible PO number
      /P\/O\s*REF\s*:?\s*([A-Z0-9\s]{3,20})/i,  // More flexible P/O REF
      
      // Look for standalone PO patterns
      /\b(PO\d{4,10})\b/i,
      /\b(po\d{4,10})\b/i,
      /\b(P\d{5,10})\b/i,  // Pattern like P055903
      /\b(POR\d{4,10})\b/i,  // Pattern like POR5919
      
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
    console.log("Text being searched:", text.substring(0, 1000));
    
    for (let i = 0; i < poPatterns.length; i++) {
      const pattern = poPatterns[i];
      const match = text.match(pattern);
      console.log(`PO Pattern ${i+1}/${poPatterns.length}: ${pattern}`);
      console.log(`PO Match result:`, match);
      if (match && match[1]) {
        let poNumber = match[1].trim();
        console.log(`Raw PO match: "${poNumber}"`);
        
        // Clean up OCR artifacts in PO number
        poNumber = poNumber.replace(/\s+/g, ''); // Remove all spaces first

        // Handle specific OCR patterns based on what we see in logs
        if (!poNumber.startsWith('P')) {
          // If it doesn't start with P, add it (for numbers like "055903")
          poNumber = 'P' + poNumber;
        }

        // Keep POR as is for WAH LEI documents - don't convert to PO
        // But need to handle OCR character replacement carefully

        // OCR character corrections - handle WAH LEI special case
        if (poNumber.toUpperCase().startsWith('POR')) {
          // WAH LEI case: "POR 5919" should be "PO55919" (OCR misread "55" as "R 5")
          poNumber = poNumber.replace(/^POR\s*/, 'PO5'); // Convert "POR " to "PO5"
          poNumber = poNumber.replace(/[O]/g, '0'); // Replace O with 0
          poNumber = poNumber.replace(/[Il]/g, '1'); // Replace I,l with 1
          poNumber = poNumber.replace(/[^a-zA-Z0-9]/g, ''); // Remove other artifacts
        } else {
          // For other PO numbers, apply normal cleaning
          poNumber = poNumber.replace(/[O]/g, '0'); // Replace O with 0
          poNumber = poNumber.replace(/[Il]/g, '1'); // Replace I,l with 1
          poNumber = poNumber.replace(/[^a-zA-Z0-9]/g, ''); // Remove other artifacts but keep letters
        }
        
        console.log(`Cleaned PO: "${poNumber}"`);
        
        // More lenient validation for PO numbers
        const isValidFormat = /^[a-zA-Z0-9\-_\/\s]+$/.test(poNumber); // Allow spaces
        const isValidLength = poNumber.length >= 2 && poNumber.length <= 30;
        const hasNumbers = /\d/.test(poNumber); // Must contain at least one number
        const hasLetters = /[a-zA-Z]/.test(poNumber); // Must contain at least one letter (for PO prefix)
        
        console.log(`PO validation - Length: ${poNumber.length}, Format valid: ${isValidFormat}, Length valid: ${isValidLength}, Has numbers: ${hasNumbers}, Has letters: ${hasLetters}`);
        
        // Be more lenient - accept if it has reasonable length and contains numbers
        if (isValidLength && (hasNumbers || hasLetters) && !/^(position|page|delivery|order)$/i.test(poNumber)) {
          console.log(`✅ PO NUMBER FOUND: "${poNumber}" using pattern ${i+1}`);
          extractedData.poNumber = poNumber;
          break;
        } else {
          console.log(`❌ PO rejected - length: ${poNumber.length}, format: ${isValidFormat}, has numbers: ${hasNumbers}, has letters: ${hasLetters}`);
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
    console.log("Text being searched for project:", text.substring(0, 1000));
    
    for (let i = 0; i < projectPatterns.length; i++) {
      const pattern = projectPatterns[i];
      const match = text.match(pattern);
      console.log(`Project Pattern ${i+1}/${projectPatterns.length}: ${pattern}`);
      console.log(`Project Match result:`, match);
      if (match && match[1]) {
        let projectNumber = match[1].trim();
        console.log(`Raw project match: "${projectNumber}"`);
        const isValidLength = projectNumber.length >= 2 && projectNumber.length <= 30;
        const hasContent = /[a-zA-Z0-9]/.test(projectNumber); // Must have some content
        console.log(`Project validation - Length: ${projectNumber.length}, Valid: ${isValidLength}, Has content: ${hasContent}`);
        if (isValidLength && hasContent && !/^(position|page|delivery|order|date|number)$/i.test(projectNumber)) {
          console.log(`✅ PROJECT NUMBER FOUND: "${projectNumber}" using pattern ${i+1}`);
          extractedData.projectNumber = projectNumber;
          break;
        } else {
          console.log(`❌ Project rejected - length: ${projectNumber.length}, has content: ${hasContent}`);
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
    console.log("Text being searched for job:", text.substring(0, 1000));
    
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
        const isValidLength = jobNumber.length >= 2 && jobNumber.length <= 30;
        const hasContent = /[a-zA-Z0-9]/.test(jobNumber); // Must have some content
        console.log(`Job validation - Length: ${jobNumber.length}, Valid: ${isValidLength}, Has content: ${hasContent}`);
        if (isValidLength && hasContent && !/^(position|page|delivery|order|date|number)$/i.test(jobNumber)) {
          console.log(`✅ JOB NUMBER FOUND: "${jobNumber}" using pattern ${i+1}`);
          extractedData.jobNumber = jobNumber;
          break;
        } else {
          console.log(`❌ Job rejected - length: ${jobNumber.length}, has content: ${hasContent}`);
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
    console.log("Text being searched for DO:", text.substring(0, 1000));
    
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
        const isValidLength = doNumber.length >= 2 && doNumber.length <= 30;
        const hasContent = /[a-zA-Z0-9]/.test(doNumber); // Must have some content
        console.log(`DO validation - Length: ${doNumber.length}, Valid: ${isValidLength}, Has content: ${hasContent}`);
        if (isValidLength && hasContent && !/^(position|page|delivery|order|date|number)$/i.test(doNumber)) {
          console.log(`✅ DO NUMBER FOUND: "${doNumber}" using pattern ${i+1}`);
          extractedData.doNumber = doNumber;
          break;
        } else {
          console.log(`❌ DO rejected - length: ${doNumber.length}, has content: ${hasContent}`);
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
      /delivery\s*date[:\s]*(\d{1,2}[\s\/\-]\w{3,9}[\s\/\-]\d{2,4})/i,
      // Enhanced patterns for better date detection
      /(\d{1,2}\.\d{1,2}\.\d{2,4})/i,  // DD.MM.YYYY format (common in European documents)
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/i,  // DD/MM/YYYY format
      /(\d{1,2}-\d{1,2}-\d{2,4})/i,   // DD-MM-YYYY format
      /(Aug\s+\d{1,2},?\s+\d{4})/i,   // Aug 6, 2025 format
      /(\d{1,2}\s+Aug\s+\d{4})/i,     // 6 Aug 2025 format
      /(\d{1,2}\.\d{1,2}\.\d{4})/i,   // 08.08.2025 format
    ];

    // Look for specific date patterns first
    console.log("=== DATE EXTRACTION ===");
    console.log("Text being searched for dates:", text.substring(0, 1000));
    
    for (let i = 0; i < datePatterns.length; i++) {
      const pattern = datePatterns[i];
      const match = text.match(pattern);
      console.log(`Date Pattern ${i+1}/${datePatterns.length}: ${pattern}`);
      console.log(`Date Match result:`, match);
      
      if (match && match[1]) {
        const dateValue = match[1].trim();
        console.log(`Raw date match: "${dateValue}"`);
        
        if (pattern.toString().includes('delivery')) {
          extractedData.deliveryDate = dateValue;
          console.log(`✅ DELIVERY DATE FOUND: "${dateValue}"`);
        } else if (!extractedData.date) {
          extractedData.date = dateValue;
          console.log(`✅ DATE FOUND: "${dateValue}"`);
        }
      } else {
        console.log(`❌ No match for date pattern ${i+1}`);
      }
    }
    
    console.log(`Final date result: "${extractedData.date}"`);
    console.log(`Final delivery date result: "${extractedData.deliveryDate}"`);
    console.log("=== END DATE EXTRACTION ===\n");

    // If no specific dates found, look for any dates in the document
    if (!extractedData.date) {
      console.log("=== FALLBACK DATE EXTRACTION ===");
      const allDates = text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/g);
      if (allDates && allDates.length > 0) {
        extractedData.date = allDates[0];
        console.log('Fallback date extraction successful:', extractedData.date);
        if (allDates.length > 1 && !extractedData.deliveryDate) {
          extractedData.deliveryDate = allDates[1];
          console.log('Fallback delivery date extraction successful:', extractedData.deliveryDate);
        }
      } else {
        // Try to find any date-like patterns
        const anyDatePattern = text.match(/(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4})/);
        if (anyDatePattern) {
          extractedData.date = anyDatePattern[1];
          console.log('Fallback date pattern extraction successful:', extractedData.date);
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

  // AGGRESSIVE FALLBACK EXTRACTION - Extract ANYTHING that looks like data
  console.log("\n=== AGGRESSIVE FALLBACK EXTRACTION ===");
  console.log("Current extracted data before fallback:", extractedData);
  
  // Extract ANY capitalized line as supplier if we don't have one
  if (!extractedData.supplier || extractedData.supplier.length < 2) {
    const lines = text.split('\n');
    for (const line of lines.slice(0, 15)) { // Check first 15 lines
      const trimmedLine = line.trim();
      if (trimmedLine.length > 3 && /^[A-Z]/.test(trimmedLine)) {
        extractedData.supplier = trimmedLine;
        console.log('AGGRESSIVE supplier extraction:', extractedData.supplier);
        break;
      }
    }
  }
  
  // Extract ANY alphanumeric pattern as PO if we don't have one
  if (!extractedData.poNumber || extractedData.poNumber.length < 2) {
    // Try multiple patterns
    const patterns = [
      /\b(P[O0]?\d{3,10})\b/i,
      /\b([A-Z]{1,3}\d{3,10})\b/,
      /\b(\d{4,10})\b/,
      /\b([A-Z]\d{4,10})\b/
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        extractedData.poNumber = match[1];
        console.log('AGGRESSIVE PO extraction:', extractedData.poNumber);
        break;
      }
    }
  }
  
  // Extract ANY date-like pattern
  if (!extractedData.date || extractedData.date.length < 2) {
    const datePatterns = [
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
      /(\d{1,2}\.\d{1,2}\.\d{4})/,
      /(\d{1,2}\/\d{1,2}\/\d{4})/,
      /(\d{1,2}-\d{1,2}-\d{4})/,
      /(\d{4}-\d{2}-\d{2})/
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        extractedData.date = match[1];
        console.log('AGGRESSIVE date extraction:', extractedData.date);
        break;
      }
    }
  }
  
  // Extract ANY alphanumeric pattern as project number
  if (!extractedData.projectNumber || extractedData.projectNumber.length < 2) {
    const projectPatterns = [
      /\b(PRJ\d{2,10})\b/i,
      /\b(PROJ\d{2,10})\b/i,
      /\b(PROJECT\d{2,10})\b/i,
      /\b([A-Z]{2,}\d{2,10})\b/
    ];
    
    for (const pattern of projectPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        extractedData.projectNumber = match[1];
        console.log('AGGRESSIVE project extraction:', extractedData.projectNumber);
        break;
      }
    }
  }
  
  // Extract ANY alphanumeric pattern as job number
  if (!extractedData.jobNumber || extractedData.jobNumber.length < 2) {
    const jobPatterns = [
      /\b(JOB\d{2,10})\b/i,
      /\b(J\d{2,10})\b/i,
      /\b([A-Z]{1,2}\d{2,10})\b/
    ];
    
    for (const pattern of jobPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        extractedData.jobNumber = match[1];
        console.log('AGGRESSIVE job extraction:', extractedData.jobNumber);
        break;
      }
    }
  }
  
  // Extract ANY alphanumeric pattern as DO number
  if (!extractedData.doNumber || extractedData.doNumber.length < 2) {
    const doPatterns = [
      /\b(DO\d{2,10})\b/i,
      /\b(D\d{2,10})\b/i,
      /\b([A-Z]{1,2}\d{2,10})\b/
    ];
    
    for (const pattern of doPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        extractedData.doNumber = match[1];
        console.log('AGGRESSIVE DO extraction:', extractedData.doNumber);
        break;
      }
    }
  }
  
  console.log("FINAL EXTRACTED DATA AFTER AGGRESSIVE FALLBACK:");
  console.log("Supplier:", extractedData.supplier);
  console.log("PO Number:", extractedData.poNumber);
  console.log("Project Number:", extractedData.projectNumber);
  console.log("Job Number:", extractedData.jobNumber);
  console.log("DO Number:", extractedData.doNumber);
  console.log("Date:", extractedData.date);
  console.log("=== END AGGRESSIVE FALLBACK ===");

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
    
    // Use Tesseract OCR to extract text from the image with enhanced settings
    console.log("Starting Tesseract OCR processing...");
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status && m.progress !== undefined) {
          console.log(`Tesseract: ${m.status} - ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    // Configure Tesseract for better OCR results
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,;:()[]{}+-*/%$#@!?&\'"\\n\\r\\t\\-_/ ',
      tessedit_pageseg_mode: 1 as any,
      tessedit_ocr_engine_mode: 1 as any,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });

    const result = await worker.recognize(filePath);
    await worker.terminate();
    
    const extractedText = result.data.text;
    
    console.log("Tesseract OCR completed successfully");
    console.log("Extracted text length:", extractedText.length);
    console.log("First 500 characters:", extractedText.substring(0, 500));
    console.log("Full extracted text:", extractedText);
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("No text could be extracted from the image");
    }
    
    // Extract structured data from the text using our pattern matching
    const extractedData = extractDataFromText(extractedText);
    
    console.log("Extracted data from image:", extractedData);
    
    return {
      ...extractedData,
      pageCount: 1,
      documentType: "image_ocr",
      confidence: result.data.confidence / 100, // Convert to 0-1 scale
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

// Google Vision processing removed - app now uses client-side PDF.js + Tesseract
// This provides better performance and eliminates server-side dependencies

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
          
          // Always process as multiple documents for PDFs, even if only 1 page
          console.log(`Processing ${multipleDocuments.length} documents from PDF`);
          
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
              await saveDocument(result);
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
          console.log("PDF uploaded but no pre-extracted text provided");
          console.log("Please use the client-side PDF.js + Tesseract processing instead");
          
          // Return a message indicating client-side processing is preferred
          extractedData = {
            supplier: "",
            poNumber: "",
            projectNumber: "",
            jobNumber: "",
            doNumber: "",
            date: "",
            deliveryDate: "",
            items: [],
            pageCount: 1,
            documentType: "pdf_server_fallback",
            confidence: 0.0,
            rawData: {
              message: "Please use client-side PDF processing for better results",
              fileName: req.file.originalname,
              fileSize: req.file.size,
              processingMethod: "server_fallback"
            }
          };
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
          await saveDocument(result);
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
            console.log("PDF file detected - using Tesseract fallback processing:", file.originalname);
            // For batch processing, we'll use a simple fallback since client-side processing is preferred
            extractedData = {
              supplier: "",
              poNumber: "",
              projectNumber: "",
              jobNumber: "",
              doNumber: "",
              date: "",
              deliveryDate: "",
              items: [],
              pageCount: 1,
              documentType: "pdf_batch_fallback",
              confidence: 0.0,
              rawData: {
                message: "Batch PDF processing - use individual upload for better OCR results",
                fileName: file.originalname,
                fileSize: file.size,
                processingMethod: "batch_fallback"
              }
            };
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
          await saveDocument(result);
          
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
