import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { saveDocument, getAllDocuments, getDocumentById, deleteDocument } from '../database';
import { processWithOCRSpace, processPDFWithOCRSpace } from '../services/ocr-space';

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
    prNumber: "Not found",
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
    
    // STEP 1: Find supplier
    console.log("\n🏢 FINDING SUPPLIER...");

    // Strategy 1: Find customer section then look BEFORE it for company name
    if (result.supplier === "Not found") {
      console.log("  🔍 Looking for company name before customer section...");

      let customerLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/C\s*M\s*R\s*\(.*Far.*East.*\)|Customer|Ship\s*to|Bill\s*to|Sold\s*to/i)) {
          customerLineIndex = i;
          console.log(`  📍 Customer section starts at line ${i + 1}`);
          break;
        }
      }

      const searchLimit = customerLineIndex > 0 ? customerLineIndex : Math.min(10, lines.length);

      for (let i = 0; i < searchLimit; i++) {
        const line = lines[i];

        if (line.match(/\b(Pte\.?\s*Ltd|PTELTD|Limited|Corporation|Corp\.?|Inc\.?|Company|Electronic|Enterprise|Supply|Industrial|Trading|Services?)\b/i)) {
          if (line.match(/(^\d|Road|Street|Avenue|Crescent|Drive|Lane|Boulevard|Singapore\s*\d{6}|Tel:|Fax:|Email:|Website:|www\.|http|Page\s*\d|GST|Registration|Company\s*Registration\s*no|#\d{2}-\d{2})/i)) {
            console.log(`  ⏭️ Skipping address/contact/recipient line: "${line.substring(0, 60)}..."`);
            continue;
          }

          if (line.length < 8) {
            console.log(`  ⏭️ Skipping short line: "${line}"`);
            continue;
          }

          const alphaCount = (line.match(/[a-zA-Z]/g) || []).length;
          if (alphaCount < 5) {
            console.log(`  ⏭️ Skipping non-text line: "${line}"`);
            continue;
          }

          // Remove common OCR prefixes like "DQ 4 ", "A B ", etc.
          let cleanedLine = line.replace(/^[A-Z]{1,2}\s+\d{1,2}\s+/, ''); // Remove "DQ 4 " pattern
          cleanedLine = cleanedLine.replace(/^[A-Z][a-z]?\s+[A-Z][a-z]?\s+/, ''); // Remove "A b " pattern

          result.supplier = cleanedLine.trim();
          console.log(`✅ Found supplier in line ${i + 1}: "${cleanedLine.trim()}"`);
          break;
        }
      }
    }
    
    // If still not found, try extracting from company name patterns in text
    if (result.supplier === "Not found") {
      console.log("  🔍 Trying to extract supplier from full text patterns...");
      const companyPatterns = [
        /([A-Z][A-Z\s&]+(?:SUPPLY|INDUSTRIAL|TRADING|ENGINEERING)[\sA-Z&]*(?:CO\.?|COMPANY)?\s*(?:PTE\.?\s*LTD|PTELtd|Ltd|Limited))/i,
        /\b([A-Z][A-Za-z\s&]+(?:Pte\.?\s*Ltd|PTELTD|Ltd|Limited|Corporation|Corp|Inc))\b/gi,
      ];

      for (const pattern of companyPatterns) {
        const matches = Array.from(fullText.matchAll(new RegExp(pattern.source, pattern.flags)));
        if (matches && matches.length > 0) {
          // Take the first match that's not too long (likely not a paragraph)
          for (const match of matches) {
            const companyName = match[1] || match[0];
            if (companyName.length > 10 && companyName.length < 100 &&
                !companyName.match(/Customer|Signature|Stamp|Registration|Address|Freight/i)) {
              result.supplier = companyName.trim();
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
      /P\/[OQ]\s*REF\s*[;:]\s*(PO[R0-9S]{5,6})/i,  // "P/O REF ; PO55919" or "P/Q REF ; POR591S" (OCR errors)
      /P\/[OQ]\s*REF\s*[;:]\s*(P[OR0-9S]{5,7})/i,  // "P/O REF ; POR591S" without PO prefix
      /Your\s*order\s*no\.?\s*:\s*(PO\d{5,6})/i,  // Exact match for "Your order no.: PO55903"
      /Your\s*P[\.\s]*O[\.\s]*No\.?\s*:\s*(PO\d{5,6})/i,  // "Your PO No: PO55918"
      /Your\s*order\s*no\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,  // Fallback with flexible format
      /Your\s*P[\.\s]*O[\.\s]*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /P\.?\s*O\.?\s*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /Purchase\s*Order\s*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /Order\s*No\.?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      /P\.?O\.?\s*#?\s*:?\s*([A-Z]?\s*[O0]?\s*\d{5,6})/i,
      // Standalone patterns
      /\b(PO[R0-9]{5,7}[A-Z]?)\b/i,  // Handle OCR errors: POR591S
      /\b(PO\d{5,6})\b/i,
      /\b(P\s*O\s*\d{5,6})\b/i,
      /\b(P\s*\d{5,6})\b(?!\.)/i  // P followed by numbers but not P.O.
    ];
    
    for (const pattern of poPatterns) {
      const match = fullText.match(pattern);
      console.log(`  🔍 Testing pattern ${pattern}: ${match ? 'MATCH' : 'no match'}`);
      if (match && match[1]) {
        let po = match[1];
        console.log(`  📍 Raw PO captured: "${po}"`);

        // Clean up the PO number
        po = po.replace(/\s+/g, ''); // Remove spaces
        po = po.replace(/[O]/g, '0'); // Replace O with 0
        po = po.replace(/[R]/g, '5'); // Replace R with 5 (common OCR error)
        po = po.replace(/[S]$/i, '9'); // Replace trailing S with 9 (POR591S -> PO55919)
        console.log(`  🧹 After cleanup: "${po}"`);
        
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
      /D\/O\s*NO\.\s*:\s*([A-Z0-9]+)/i,  // "D/O NO. : DO25081029"
      /Delivery\s*Order\s*No\.?\s*:\s*([A-Z]?\d{7,10})/i,  // "Delivery Order No. : D2508040"
      /Delivery\s*Order\s*No\.?\s*:\s*([A-Z]\d{6,10})/i,  // Letter + digits
      /Delivery:\s*(\d{7,12})/i,  // "Delivery: 826107562"
      /DO\s*No\.?\s*:?\s*([A-Z]?\d{6,12})/i,
      /D\.?O\.?\s*No\.?\s*:?\s*([A-Z]?\d{6,12})/i,
      /\b(DO\d{8,10})\b/i,  // DO followed by 8-10 digits
      /\b(D\d{7,10})\b/,  // D followed by 7-10 digits
      /\b(\d{9})\b/  // 9-digit numbers like 826107562
    ];
    
    for (const pattern of doPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        console.log(`  🔍 Testing pattern ${pattern}: found "${match[1]}"`);

        // Avoid Singapore postal codes (exactly 6 digits)
        if (match[1].match(/^\d{6}$/)) {
          console.log(`  ⏭️ Skipping postal code: "${match[1]}"`);
          continue;
        }

        // Skip if the number appears near GST/Registration keywords
        const matchIndex = fullText.indexOf(match[1]);
        const contextStart = Math.max(0, matchIndex - 100);
        const contextEnd = Math.min(fullText.length, matchIndex + 100);
        const context = fullText.substring(contextStart, contextEnd);

        console.log(`  📍 Context around "${match[1]}": "${context.substring(0, 150)}..."`);

        if (context.match(/GST|Registration|Company\s*Registration|Tax\s*Registration/i)) {
          console.log(`  ⏭️ Skipping number near GST/Registration: "${match[1]}"`);
          continue;
        }

        result.doNumber = match[1];
        console.log(`✅ Found DO: "${match[1]}" using pattern: ${pattern}`);
        break;
      }
    }
    
    // Fallback: Look for DO in context (line-by-line search)
    if (result.doNumber === "Not found") {
      console.log("  🔍 Searching for DO number in context...");

      // Priority 1: Look for "Delivery:" followed by number in next few lines
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^Delivery:\s*$/i)) {
          console.log(`  📍 Found "Delivery:" label at line ${i + 1}, checking next lines...`);
          // Check next 3 lines for a number
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const numMatch = lines[j].match(/^\s*(\d{7,12})\s*$/);
            if (numMatch) {
              const matchIndex = fullText.indexOf(numMatch[1]);
              const context = fullText.substring(Math.max(0, matchIndex - 100), Math.min(fullText.length, matchIndex + 100));

              if (!context.match(/GST|Registration|Company\s*Registration/i)) {
                result.doNumber = numMatch[1];
                console.log(`✅ Found DO after "Delivery:" label: "${numMatch[1]}" at line ${j + 1}`);
                break;
              }
            }
          }
          if (result.doNumber !== "Not found") break;
        }
      }
    }

    // Fallback 2: Generic context search
    if (result.doNumber === "Not found") {
      console.log("  🔍 Generic context search for delivery/order numbers...");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/delivery|d\.?o\.?/i) && !line.match(/order\s*no/i)) {
          const doMatch = line.match(/\b([D]\d{6,9}|\d{7,9})\b/i);
          if (doMatch && !doMatch[1].match(/^\d{6}$/)) {
            const matchIndex = fullText.indexOf(doMatch[1]);
            const context = fullText.substring(Math.max(0, matchIndex - 100), Math.min(fullText.length, matchIndex + 100));

            if (!context.match(/GST|Registration|order\s*no/i)) {
              result.doNumber = doMatch[1];
              console.log(`✅ Found DO via context: "${doMatch[1]}" at line ${i + 1}`);
              break;
            }
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
        // Try 4-digit year first
        const dateMatch4 = line.match(/\b(\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]20\d{2})\b/);
        if (dateMatch4) {
          result.date = dateMatch4[1];
          console.log(`✅ Found date via fallback: "${dateMatch4[1]}"`);
          break;
        }
        // Try 2-digit year (convert to 4-digit)
        const dateMatch2 = line.match(/\bDATE\s*[:\s]*(\d{1,2}[\.\/\-]\d{1,2}[\.\/\-])(\d{2})\b/i);
        if (dateMatch2) {
          const yearDigits = dateMatch2[2];
          // For delivery orders, assume years are from 2000s
          // Special case: If "95" appears but document has "2025" elsewhere, likely OCR error
          const fullYear = yearDigits === '95' && fullText.includes('2025') ? '2025' : `20${yearDigits}`;
          result.date = `${dateMatch2[1]}${fullYear}`;
          console.log(`✅ Found date with 2-digit year, converted: "${result.date}"`);
          break;
        }
      }
    }
    
    // STEP 5: Find PR Number
    console.log("\n📋 FINDING PR NUMBER...");
    const prPatterns = [
      /[\|\s]PR:\s*([iI]?[Ss]?\d{4,6}[A-Z]?)/i,  // "| PR:iS3016" or " PR:S3016" (with pipe or space before)
      /PR:\s*([iI]?[Ss]?\d{4,6}[A-Z]?)/i,  // "PR:iS3016" or "PR:S3016" (OCR errors)
      /Your\s*PR\s*No\.?\s*:\s*(PR\d{5,6})/i,  // "Your PR No: PR53014"
      /Your\s*P[\.\s]*R[\.\s]*No\.?\s*:\s*(PR\d{5,6})/i,
      /PR\s*No\.?\s*:\s*(PR\d{5,6})/i,
      /P\.?R\.?\s*#?\s*:?\s*(PR\d{5,6})/i,
      /\b(PR[iI]?[Ss]?\d{4,6}[A-Z]?)\b/i,  // "PRiS3016" or "PR53017"
      /\b(PR\d{5,6})\b/i
    ];

    for (const pattern of prPatterns) {
      const match = fullText.match(pattern);
      console.log(`  🔍 Testing PR pattern ${pattern}: ${match ? 'MATCH' : 'no match'}`);
      if (match && match[1]) {
        console.log(`  📍 Raw PR captured: "${match[1]}"`);
        let pr = match[1];
        // Clean up the PR number
        pr = pr.replace(/\s+/g, ''); // Remove spaces
        pr = pr.replace(/^[iI]/i, ''); // Remove leading 'i' (OCR error: iS301E -> S301E)
        pr = pr.replace(/^[Ss]/i, ''); // Remove leading 'S' (OCR error: S301E -> 301E)
        pr = pr.replace(/[E]$/i, '6'); // Replace trailing E with 6 (301E -> 3016)
        console.log(`  🧹 After initial cleanup: "${pr}"`);

        // Ensure it starts with PR
        if (pr.match(/^P\d/)) {
          pr = 'PR' + pr.substring(1);
        } else if (pr.match(/^\d/)) {
          pr = 'PR' + pr;
        }
        // Remove leading zeros after PR (PR053014 -> PR53014)
        pr = pr.replace(/^PR0+(\d)/, 'PR$1');
        console.log(`  🧹 After adding PR prefix: "${pr}"`);

        if (pr.match(/^PR\d{4,6}$/)) {
          result.prNumber = pr;
          console.log(`✅ Found PR: "${pr}" using pattern: ${pattern}`);
          break;
        } else {
          console.log(`  ❌ Rejected "${pr}" - doesn't match final validation /^PR\\d{4,6}$/`);
        }
      }
    }

    // STEP 6: Find Job Number (search entire document)
    console.log("\n🔨 FINDING JOB NUMBER...");
    const jobPatterns = [
      /Your\s*Job\s*No\.?\s*:\s*([A-Z0-9]{5,10})/i,  // "Your Job No : 25006YB"
      /Job\s*No\.?\s*:\s*([A-Z0-9]{5,10})/i,
      /Job\s*No\.\s*([A-Z0-9]{5,10})/i,
      /Job:\s*([A-Z0-9]{5,10})/i
    ];

    // Search entire document for job number
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

    // Strategy: In tabular format, quantity (e.g., "20 PC") is on separate line from description
    // First, find all lines with PC/PCS/ea to see what we're working with
    console.log("  🔍 Scanning for lines with PC/PCS/ea...");
    const pcLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/\bPC\b|\bPCS\b|\bea\b/i)) {
        pcLines.push(i);
        console.log(`  📍 Line ${i + 1} has unit: "${lines[i].substring(0, 80)}"`);
      }
    }

    // WAH LEI format: Look for "ITEM NO: 001" pattern or table header "ITEM NO"
    // These documents have heavy barcode interference, so filter for clean text
    const wahLeiItemStart: number[] = [];
    let wahLeiItemNoColumn = -1;

    for (let i = 0; i < lines.length; i++) {
      // Check for table header with "ITEM NO"
      if (lines[i].match(/ITEM\s+NO/i) && lines[i].match(/DESCRIPTION/i)) {
        wahLeiItemNoColumn = i;
        console.log(`  🏷️ WAH LEI table header found at line ${i + 1}: "${lines[i].substring(0, 100)}"`);
        continue;
      }

      // Check for direct "ITEM NO: 001" format
      if (lines[i].match(/ITEM\s+NO\s*:?\s*\d{3}/i)) {
        wahLeiItemStart.push(i);
        console.log(`  🏷️ WAH LEI item marker at line ${i + 1}: "${lines[i].substring(0, 80)}"`);
      }
    }

    // If we found a table header, look for items in subsequent lines
    if (wahLeiItemNoColumn >= 0 && wahLeiItemStart.length === 0) {
      console.log(`  🔍 Searching for items after table header at line ${wahLeiItemNoColumn + 1}...`);
      for (let i = wahLeiItemNoColumn + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        console.log(`    📍 Line ${i + 1}: "${line.substring(0, 80)}"`);

        // PRIORITY 1: Look for product description keywords (LED BULB, LAMP, etc.)
        // These lines contain actual item data
        if (line.match(/LED\s+BULB|LIGHT|LAMP|CABLE|WIRE|SWITCH|OSRAM|PHILIPS/i) && line.length > 15) {
          // Check if line is mostly clean (not barcode gibberish)
          const gibberishScore = (line.match(/[0-9]/g) || []).length / line.length;
          const hasLongNumberSeq = line.match(/[0-9]{8,}/);

          if (gibberishScore < 0.5 && !hasLongNumberSeq) {
            console.log(`    ✅ Found product description line (contains LED/BULB/etc.)`);
            wahLeiItemStart.push(i);
          }
        }
        // PRIORITY 2: Line starting with item number (1-3 digits) but NOT gibberish
        else if (line.match(/^[0-9]{1,3}\s+[A-Z]/)) {
          const gibberishScore = (line.match(/[0-9]/g) || []).length / line.length;
          const hasLongNumberSeq = line.match(/[0-9]{8,}/);

          if (gibberishScore < 0.5 && !hasLongNumberSeq) {
            console.log(`    ✓ Potential item line found (number prefix, low gibberish)`);
            wahLeiItemStart.push(i);
          } else {
            console.log(`    ❌ Skipping gibberish line (starts with number but high gibberish score)`);
          }
        }

        if (wahLeiItemStart.length >= 20) break;
      }
    }

    // If WAH LEI format detected, extract items differently
    if (wahLeiItemStart.length > 0) {
      console.log(`  📦 Detected WAH LEI format, extracting ${wahLeiItemStart.length} items...`);
      for (let idx = 0; idx < wahLeiItemStart.length; idx++) {
        const itemStartIdx = wahLeiItemStart[idx];
        const itemLine = lines[itemStartIdx].trim();
        const itemNo = String(idx + 1).padStart(3, '0');

        let description = '';
        let quantity = '';

        console.log(`    🔍 Extracting item ${itemNo} from line ${itemStartIdx + 1}: "${itemLine.substring(0, 80)}"`);

        // If this line contains product description (LED BULB, etc.)
        if (itemLine.match(/LED\s+BULB|LIGHT|LAMP|CABLE|WIRE|OSRAM|PHILIPS/i)) {
          // Clean up the description: remove leading dots/pipes, trailing garbage
          description = itemLine.replace(/^[\.\|\s]+/, '').trim();

          // Remove trailing period and numbers that look like OCR artifacts
          description = description.replace(/\s*\.\s*[A-Z]{2,}\s+\d+\s+\d+\s*$/, '').trim();

          console.log(`    ✓ Product description extracted: "${description.substring(0, 60)}"`);

          // Look for quantity in nearby lines (within 5 lines before/after)
          for (let j = Math.max(0, itemStartIdx - 5); j < Math.min(itemStartIdx + 8, lines.length); j++) {
            const nearLine = lines[j].trim();

            // Look for standalone "15 PC" or within line like "001 ... 15 PC"
            const qtyMatch = nearLine.match(/(\d{1,4})\s+(PC|PCS)\b/i);
            if (qtyMatch && parseInt(qtyMatch[1]) < 10000 && !nearLine.match(/[0-9]{8,}/)) {
              quantity = `${qtyMatch[1]} ${qtyMatch[2].toUpperCase()}`;
              console.log(`    ✓ Found nearby quantity at line ${j + 1}: "${quantity}"`);
              break;
            }
          }
        }
        // Otherwise, look forward for description
        else {
          // Look for DESCRIPTION line (clean text, not gibberish)
          for (let j = itemStartIdx; j < Math.min(itemStartIdx + 15, lines.length); j++) {
            const line = lines[j].trim();

            // Skip empty lines
            if (!line) continue;

            // Check if line looks like gibberish
            const gibberishScore = (line.match(/[0-9]/g) || []).length / line.length;
            const hasRandomChars = line.match(/[0-9]{8,}|[A-Z0-9]{15,}/);
            const isGibberish = gibberishScore > 0.5 || hasRandomChars;

            if (isGibberish) {
              console.log(`    🚫 Skipping gibberish line: "${line.substring(0, 60)}"`);
              continue;
            }

            // Look for description (clean text line with product info)
            if (!description && line.length > 10 && line.match(/[A-Z]{3,}/i) && !line.match(/^(JOB|PR|PO|DO|DATE)/i)) {
              description = line;
              console.log(`    ✓ Found description: "${description.substring(0, 60)}"`);
            }

            // Look for QUANTITY with PC/PCS
            const qtyMatch = line.match(/(\d{1,4})\s+(PC|PCS)\b/i);
            if (qtyMatch && parseInt(qtyMatch[1]) < 10000) {
              quantity = `${qtyMatch[1]} ${qtyMatch[2].toUpperCase()}`;
              console.log(`    ✓ Found quantity: "${quantity}"`);
              break;
            }
          }
        }

        if (description) {
          const combinedItem = `ITEM${itemNo}|||${description}|||${quantity || 'N/A'}`;
          itemLines.push(combinedItem);
          console.log(`  ✅ WAH LEI item ${itemNo}: ${description.substring(0, 50)}... qty: ${quantity}`);
        }
      }
    }

    // Alternative: Look for product descriptions directly (LED BULB, etc.)
    // This handles cases where table structure is completely destroyed by OCR
    if (itemLines.length === 0) {
      console.log(`  🔍 Looking for product descriptions directly in text...`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Check if line looks like a product description (LED, BULB, etc.)
        if (line.match(/LED\s+BULB|LIGHT|LAMP|CABLE|WIRE|SWITCH/i) && line.length > 15) {
          // Check if line is mostly clean (not barcode gibberish)
          const gibberishScore = (line.match(/[0-9]/g) || []).length / line.length;
          const hasLongNumberSeq = line.match(/[0-9]{8,}/);

          if (gibberishScore < 0.4 && !hasLongNumberSeq) {
            console.log(`    ✓ Found product description at line ${i + 1}: "${line.substring(0, 60)}"`);

            // Look for quantity in nearby lines
            let quantity = 'N/A';
            for (let j = Math.max(0, i - 3); j < Math.min(i + 5, lines.length); j++) {
              const nearLine = lines[j].trim();
              const qtyMatch = nearLine.match(/(\d{1,4})\s+(PC|PCS)/i);
              if (qtyMatch && parseInt(qtyMatch[1]) < 10000) {
                quantity = `${qtyMatch[1]} ${qtyMatch[2]}`;
                console.log(`    ✓ Found nearby quantity: "${quantity}"`);
                break;
              }
            }

            const itemNo = String(itemLines.length + 1).padStart(3, '0');
            const combinedItem = `ITEM${itemNo}|||${line}|||${quantity}`;
            itemLines.push(combinedItem);
            console.log(`  ✅ Direct description item ${itemNo}: ${line.substring(0, 50)}...`);

            if (itemLines.length >= 20) break;
          }
        }
      }
    }

    // Look for quantity pattern: numbers (with or without unit on same line)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Pattern 1: "20 PC" or "3,000 ea" (quantity + unit on same line)
      const qtyWithUnit = line.match(/^(\d{1,5}(?:,\d{3})?)\s+(PC|PCS|pC|Pcs|pc|pcs|ea)$/i);

      // Pattern 2: Just quantity "3,000" (unit might be on separate line or in table header)
      const qtyOnly = line.match(/^(\d{1,5}(?:,\d{3})?)$/);

      if (qtyWithUnit || qtyOnly) {
        const quantity = line;
        console.log(`  ✓ Found quantity line ${i + 1}: "${quantity}"`);

        // Look for description in next few lines
        let description = "";
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const nextLine = lines[j].trim();

          // Skip empty lines
          if (!nextLine) continue;

          // Skip if it's another quantity line
          if (nextLine.match(/^(\d{1,5}(?:,\d{3})?)\s*(PC|PCS|pC|Pcs|pc|pcs|ea)?$/i)) {
            console.log(`    ⏭️ Skipping another quantity: "${nextLine}"`);
            break;
          }

          // Skip table headers or units
          if (nextLine.match(/^(UOM|Qty|ea|PC|PCS)$/i)) {
            console.log(`    ⏭️ Skipping table header/unit: "${nextLine}"`);
            continue;
          }

          // Description should have letters and be substantial (part numbers, descriptions, etc.)
          if (nextLine.length > 5 && nextLine.match(/[a-zA-Z]/)) {
            description = nextLine;
            console.log(`    ✓ Found description at line ${j + 1}: "${description.substring(0, 60)}"`);
            break;
          }
        }

        if (description) {
          const combinedItem = `${quantity} - ${description}`;
          itemLines.push(combinedItem);
          console.log(`  ✅ Item: ${combinedItem.substring(0, 100)}...`);
          if (itemLines.length >= 20) break;
        }
      }
      // Also look for inline format (quantity and description on same line)
      else if (line.match(/\b\d+\s*(PC|PCS|pC|Pcs|pc|pcs)\b/i) && line.length > 15) {
        // Check if previous line has part number (WAGO format)
        // Format: "10/2007-8821 (60520800) 4" on line before description
        const prevLine = i > 0 ? lines[i - 1] : '';
        const partNumberLine = prevLine.match(/^\d+\/([A-Z0-9\-]+)\s*\((\d+)\)/i);

        if (partNumberLine) {
          // Store both lines together for WAGO format
          const combinedItem = `${prevLine}|||${line}`;
          itemLines.push(combinedItem);
          console.log(`  ✅ WAGO item with part number: ${prevLine.substring(0, 50)}... + ${line.substring(0, 50)}...`);
        } else {
          // Regular inline item without part number line
          itemLines.push(line);
          console.log(`  ✅ Inline item: ${line.substring(0, 100)}...`);
        }
        if (itemLines.length >= 20) break;
      }
      // SCL System format: Lines starting with S/N (1-2 digits), Stock Code (like MK-1100, CN-TM-LBC6W), and Description
      // Stock code must contain hyphen, may have extra spaces/periods: "2  CN-TM-LBC6W ."
      else if (line.match(/^([1-9]|[1-2][0-9])\s+([A-Z]{2}[0-9A-Z\-]+[0-9A-Z])[\s\.]+([A-Z]{2,})/i) &&
               line.includes('-') &&
               line.length > 15 &&
               !line.match(/\b(Jalan|Tuas|Road|Street|Avenue)\b/i)) {

        // Check if quantity is on the same line (format: "...description... 15" or "...description 6")
        const qtyOnSameLine = line.match(/\s(\d{1,3})$/);
        const descriptionLines = [line];
        let j = i + 1;
        let quantityLine = qtyOnSameLine ? qtyOnSameLine[1] : '';
        let linesChecked = 0;

        while (j < lines.length && linesChecked < 10) {
          const nextLine = lines[j].trim();
          linesChecked++;

          // Stop at packaging info (e.g., "3 5 PCS PER BOX", "5 PCS PER BOX")
          if (nextLine.match(/^\d*\s*\d+\s+(PC|PCS|pcs)\s+(PER|per)\s+(BOX|box)/i)) {
            break;
          }
          // Stop at document footer markers (Job No, PR No, DELIVER ON, terms)
          if (nextLine.match(/^(:|Job\s+No\.|PR\s+No\.|DELIVER\s+ON|Goods\s+sold)/i)) {
            break;
          }
          // Check if this is just a quantity number on its own line
          if (nextLine.match(/^\d{1,4}$/) && parseInt(nextLine) < 1000 && !quantityLine) {
            quantityLine = nextLine;
            break;
          }
          // Check if next line starts a new item
          else if (nextLine.match(/^([1-9]|[1-2][0-9])\s+([A-Z]{2,}[0-9A-Z\-]+)[\s\.]+/i) &&
                   nextLine.includes('-')) {
            break;
          }
          // If line has substantial text, it's likely a continuation
          // But exclude lines that are clearly document metadata
          else if (nextLine.length > 3 &&
                   nextLine.match(/[A-Z0-9]/i) &&
                   !nextLine.match(/^(Job|PR|PO|DO|Date|DELIVER|TERMS|TEL:)/i) &&
                   !nextLine.match(/^\d+\s+\d+\s+(PC|PCS)/i) &&
                   !nextLine.match(/^[:\|]/)) {
            descriptionLines.push(nextLine);
          }
          // Empty line might indicate end of item
          else if (nextLine.length === 0) {
            break;
          }

          j++;
        }

        // Combine all description lines with the quantity
        const combinedItem = descriptionLines.join('|||') + (quantityLine ? `|||QTY:${quantityLine}` : '');
        itemLines.push(combinedItem);
        console.log(`  ✅ SCL System item (${descriptionLines.length} lines): ${descriptionLines[0].substring(0, 50)}... qty: ${quantityLine || 'not found'}`);
        if (itemLines.length >= 20) break;
      }
    }

    // If no items found, try alternative patterns (numbered list with "ea" or inline items)
    if (itemLines.length === 0) {
      console.log("  🔍 No items with PC/PCS found, trying alternative patterns...");
      for (const line of lines) {
        // Pattern 1: Full inline format "1 111040000019 |DS2.5-01P-11-00Z(H), Terminal Block, push-in 3,000 ea"
        // Also handles OCR artifacts like "3 {11060000371" or "4 [11040000041"
        if (line.match(/^\d+\s+[\{\[\d]\d+\s+\|.*\d+\s+ea\b/i)) {
          itemLines.push(line);
          console.log(`  ✓ Numbered item with ea: ${line.substring(0, 80)}...`);
          if (itemLines.length >= 20) break;
        }
        // Pattern 2: Numbered list with part number and description (without quantity on same line)
        // Matches: "1 11040000019 DS2.5-01P-11-00Z(H), Terminal Block, push-in"
        else if (line.match(/^\d+\s+\d{10,12}\s+[\|\[]?[A-Z0-9\-\(\)]+.*[a-zA-Z]/i)) {
          itemLines.push(line);
          console.log(`  ✓ Numbered item (tabular): ${line.substring(0, 80)}...`);
          if (itemLines.length >= 20) break;
        }
        // Pattern 3: Line starting with serial number and pipe character
        // Matches: "1 111040000019 |DS2.5-01P-11-00Z(H), Terminal Block"
        else if (line.match(/^\d+\s+\d{8,}\s+\|/)) {
          itemLines.push(line);
          console.log(`  ✓ Numbered item with pipe: ${line.substring(0, 80)}...`);
          if (itemLines.length >= 20) break;
        }
        // Pattern 4: "Qty: 100" or "Quantity: 50" or "10 x Item"
        else if (line.match(/\b\d+\s*x\s*/i) || line.match(/Qty[:\s]+\d+/i) || line.match(/Quantity[:\s]+\d+/i)) {
          if (line.length > 15 && line.length < 300) {
            itemLines.push(line);
            console.log(`  ✓ Alt item: ${line.substring(0, 80)}...`);
            if (itemLines.length >= 15) break;
          }
        }
      }
    }

    // Parse items into structured format
    const parsedItems = itemLines.map((line, index) => {
      // Supports multiple formats:
      // 1. SENCONIX: "1 111040000019 |DS2.5-01P-11-00Z(H), Terminal Block, push-in 3,000 ea"
      // 2. WAGO: "10/2007-8821 (60520800) 4|||2-conductor disconnect/test tb 20 pC 0 PC 20 PC 07-03-01"
      // 3. WAH LEI: "ITEM001|||LED BULB 4FT OSRAM ST8A-1.2M 230V 17.5W|||15 PC"

      let sn = "";
      let partNumber = "";
      let description = "";
      let quantity = "";
      let uom = "";

      // WAH LEI format: "ITEM001|||description|||quantity"
      if (line.match(/^ITEM\d{3}\|\|\|/i)) {
        const parts = line.split('|||');
        if (parts.length >= 2) {
          sn = parts[0].replace(/ITEM/i, ''); // "001"
          description = parts[1].trim();

          if (parts.length >= 3 && parts[2] !== 'N/A') {
            const qtyMatch = parts[2].match(/(\d+)\s*(PC|PCS|pc|pcs)/i);
            if (qtyMatch) {
              quantity = qtyMatch[1];
              uom = qtyMatch[2].toUpperCase();
            }
          } else {
            quantity = "N/A";
            uom = "";
          }

          partNumber = "N/A"; // WAH LEI format doesn't have part numbers in this section
        }
      }
      // Check if line contains part number line separator (WAGO or SCL format)
      else if (line.includes('|||')) {
        const [partLine, descLine] = line.split('|||');

        // WAGO format: Extract part number from first line: "10/2007-8821 (60520800) 4"
        const partMatch = partLine.match(/^\d+\/([A-Z0-9\-]+)\s*\((\d+)\)/i);
        if (partMatch) {
          sn = (index + 1).toString(); // Sequential: 1, 2, 3, 4...
          partNumber = partMatch[1]; // Short form: 2007-8821

          // Extract description and quantity from second line
          const wagoMatch = descLine.match(/^(.+?)\s+(\d{1,3})\s+(PC|PCS|pc|pcs|ea)\s+\d+\s+(?:PC|PCS|pc|pcs|ea)\s+(\d{1,3})\s+(PC|PCS|pc|pcs|ea)\s+([\d-]+)$/i);
          if (wagoMatch) {
            description = wagoMatch[1].trim();
            quantity = wagoMatch[4]; // Use "Qty. delivered" column (3rd quantity)
            uom = wagoMatch[5];
          }
        } else {
          // SCL System format: Extract hyphenated code, find description start by pattern
          // First line: "1 MK-1100 BLACK M11/M1STD/M1 PRO/M1 PRO II/ 15"
          // Description likely starts with technical pattern (slashes, numbers)
          const parts = line.split('|||');
          if (parts.length >= 1) {
            const firstLine = parts[0];
            // Match S/N and stock code only
            const sclMatch = firstLine.match(/^(\d+)\s+([A-Z]{2}[A-Z0-9\-]+[A-Z0-9])\s+(.+)$/i);

            if (sclMatch && sclMatch[2].includes('-')) {
              sn = sclMatch[1];
              partNumber = sclMatch[2].trim(); // Just the hyphenated code: MK-1100, CN-TM-LBC6W

              let restOfFirstLine = sclMatch[3].trim();

              // Remove trailing quantity if present
              const qtyMatch1 = restOfFirstLine.match(/\s+(\d{1,3})$/);
              let qtyOnFirstLine = '';
              if (qtyMatch1) {
                qtyOnFirstLine = qtyMatch1[1];
                restOfFirstLine = restOfFirstLine.replace(/\s+\d{1,3}$/, '').trim();
              }

              // Try to find where description starts - look for technical patterns like "M11/" or "LABEL"
              // Description often starts with model numbers (letters+numbers+slashes) or descriptive words
              const descStartMatch = restOfFirstLine.match(/([A-Z]+\d+[\/\-][A-Z0-9\/\-\s]+|LABEL\s+.+)$/i);

              const descParts = [];
              if (descStartMatch) {
                // Found technical pattern - use that as start of description
                descParts.push(descStartMatch[0].trim());
              }

              // Add all continuation lines
              for (let k = 1; k < parts.length; k++) {
                if (!parts[k].match(/^QTY:/)) {
                  descParts.push(parts[k].trim());
                }
              }

              description = descParts.join(' ').trim();

              // Get quantity
              quantity = qtyOnFirstLine || "N/A";
              const lastPart = parts[parts.length - 1];
              const qtyMatch = lastPart.match(/^QTY:(\d+)$/);
              if (qtyMatch) {
                quantity = qtyMatch[1];
              }
              uom = "pcs";
            }
          }
        }
      } else {
        // Pattern 1: SCL System single-line format (rarely used, multi-line is more common)
        const sclSingleMatch = line.match(/^(\d+)\s+([A-Z]{2}[A-Z0-9\-]+[A-Z0-9])\s+(.+?)\s+(\d{1,4})$/i);
        if (sclSingleMatch && !line.match(/\b(PC|PCS|ea|pcs)\b/i) && line.includes('-')) {
          sn = sclSingleMatch[1];
          partNumber = sclSingleMatch[2].trim(); // Just hyphenated code: MK-1100, CN-TM-LBC6W
          description = sclSingleMatch[3].trim();
          quantity = sclSingleMatch[4];
          uom = "pcs";
        }
        // Pattern 2: SENCONIX format with pipe separator
        else if (line.match(/^(\d+)\s+[\{\[]?(\d+)\s*\|([^|]+?)\s+(\d{1,3}(?:,\d{3})?)\s+(ea|PC|PCS|pc|pcs)/i)) {
          const senconixMatch = line.match(/^(\d+)\s+[\{\[]?(\d+)\s*\|([^|]+?)\s+(\d{1,3}(?:,\d{3})?)\s+(ea|PC|PCS|pc|pcs)/i);
          if (senconixMatch) {
            sn = senconixMatch[1];
            partNumber = senconixMatch[2];
            description = senconixMatch[3].trim();
            quantity = senconixMatch[4];
            uom = senconixMatch[5];
          }
        } else {
          // Pattern 2: WAGO format without part number line - "Description Qty UOM 0 PC Qty UOM code"
          const wagoMatch = line.match(/^(.+?)\s+(\d{1,3})\s+(PC|PCS|pc|pcs|ea)\s+\d+\s+(?:PC|PCS|pc|pcs|ea)\s+(\d{1,3})\s+(PC|PCS|pc|pcs|ea)\s+([\d-]+)$/i);
          if (wagoMatch) {
            sn = (index + 1).toString();
            partNumber = "N/A";
            description = wagoMatch[1].trim();
            quantity = wagoMatch[4]; // Use "Qty. delivered" column (3rd quantity)
            uom = wagoMatch[5];
          } else {
            // Fallback: Try to extract any quantity and UOM from the line
            const quantityMatch = line.match(/(\d{1,3}(?:,\d{3})?)\s+(PC|PCS|pc|pcs|ea)\b/i);
            if (quantityMatch) {
              // Take everything before the first quantity as description
              const descBeforeQty = line.substring(0, line.indexOf(quantityMatch[0])).trim();
              sn = (index + 1).toString();
              partNumber = "N/A";
              description = descBeforeQty || line;
              quantity = quantityMatch[1];
              uom = quantityMatch[2];
            } else {
              // No pattern matched - store raw line
              sn = (index + 1).toString();
              partNumber = "N/A";
              description = line;
              quantity = "N/A";
              uom = "N/A";
            }
          }
        }
      }

      return {
        sn: sn,
        partNumber: partNumber,
        description: description,
        quantity: quantity,
        uom: uom
      };
    });

    result.items = parsedItems;
    console.log(`✅ Found ${itemLines.length} items (parsed into structured format)`);

  } catch (error) {
    console.error("❌ ERROR in extraction:", error);
  }

  // Calculate weighted confidence based on business importance
  // Critical fields (70% total weight): Supplier, PO, DO, Date
  // Optional fields (30% total weight): PR, Project, Job, Items

  let criticalScore = 0;
  let optionalScore = 0;

  // Critical fields (17.5% each = 70% total)
  if (result.supplier !== "Not found") criticalScore += 0.175;
  if (result.poNumber !== "Not found") criticalScore += 0.175;
  if (result.doNumber !== "Not found") criticalScore += 0.175;
  if (result.date !== "Not found") criticalScore += 0.175;

  // Optional fields (7.5% each = 30% total)
  if (result.prNumber !== "Not found") optionalScore += 0.075;
  if (result.projectNumber !== "Not found") optionalScore += 0.075;
  if (result.jobNumber !== "Not found") optionalScore += 0.075;
  if (result.items.length > 0) optionalScore += 0.075;

  const confidence = criticalScore + optionalScore;
  result.pageCount = confidence; // Store confidence in pageCount temporarily

  // Count fields for logging
  let foundFields = 0;
  let criticalFound = 0;
  if (result.supplier !== "Not found") { foundFields++; criticalFound++; }
  if (result.poNumber !== "Not found") { foundFields++; criticalFound++; }
  if (result.doNumber !== "Not found") { foundFields++; criticalFound++; }
  if (result.date !== "Not found") { foundFields++; criticalFound++; }
  if (result.prNumber !== "Not found") foundFields++;
  if (result.projectNumber !== "Not found") foundFields++;
  if (result.jobNumber !== "Not found") foundFields++;
  if (result.items.length > 0) foundFields++;

  console.log("\n=== EXTRACTION COMPLETE ===");
  console.log("Supplier:", result.supplier);
  console.log("PO Number:", result.poNumber);
  console.log("PR Number:", result.prNumber);
  console.log("DO Number:", result.doNumber);
  console.log("Date:", result.date);
  console.log("Job Number:", result.jobNumber);
  console.log("Items:", result.items.length);
  console.log(`📊 CONFIDENCE: ${(confidence * 100).toFixed(1)}% (${foundFields}/8 fields, ${criticalFound}/4 critical)`);
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
      console.log("🖼️ PROCESSING IMAGE FILE WITH OCR.SPACE");
      console.log("File path:", req.file.path);
      console.log("File name:", req.file.originalname);

      // Use OCR.space for OCR
      console.log("🔍 Starting OCR.space processing...");
      const { text, confidence } = await processWithOCRSpace(req.file.path, req.file.mimetype);

      console.log("🎯 OCR completed, text length:", text.length);
      console.log(`🎯 OCR confidence: ${(confidence * 100).toFixed(1)}%`);
      console.log("🎯 OCR raw text:");
      console.log(text);
      console.log("🎯 End OCR text");

      console.log("🔥 CALLING EXTRACTION FUNCTION");
      const extractedData = extractSimpleData(text);
      console.log("🔥 EXTRACTION FUNCTION RETURNED:", extractedData);

      // Get extraction confidence from pageCount field (where we temporarily stored it)
      const extractionConfidence = extractedData.pageCount || 0;

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
          confidence: extractionConfidence, // Use extraction confidence, not OCR confidence
          rawData: {
            originalText: text,
            ocrMethod: "ocr.space",
            fileName: req.file.originalname,
            fileSize: req.file.size,
            ocrConfidence: confidence // Store OCR confidence separately
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
    
    // Handle PDF files with OCR.space
    if (req.file.mimetype === 'application/pdf') {
      console.log("📄 PROCESSING PDF FILE WITH OCR.SPACE");
      console.log("File path:", req.file.path);
      console.log("File name:", req.file.originalname);

      try {
        // Get PDF page count
        const { PDFDocument: PDFDoc } = await import('pdf-lib');
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDoc.load(pdfBytes);
        const pageCount = pdfDoc.getPageCount();

        console.log(`📄 PDF has ${pageCount} pages`);

        // Process PDF with OCR.space (will split if > 3 pages)
        const pageResults = await processPDFWithOCRSpace(req.file.path, pageCount);

        // Single document or multiple pages
        const processedDocuments = [];

        for (let i = 0; i < pageResults.length; i++) {
          const pageResult = pageResults[i];
          const extractedData = extractSimpleData(pageResult.text);

          const result = {
            id: (Date.now() + i).toString(),
            originalName: pageResults.length > 1 ? `${req.file.originalname} (Page ${pageResult.pageNumber})` : req.file.originalname,
            renamedName: `${extractedData.supplier || "Unknown"}_${extractedData.poNumber || "Unknown"}_${req.file.originalname}${pageResults.length > 1 ? `_Page${pageResult.pageNumber}` : ''}`,
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
              documentType: pageResults.length > 1 ? "pdf_multipage" : "pdf_ocr",
              confidence: pageResult.confidence,
              pageCount: pageCount,
              rawData: {
                originalText: pageResult.text,
                ocrMethod: "ocr.space",
                fileName: req.file.originalname,
                fileSize: req.file.size,
                pageCount: pageCount,
                pageIndex: pageResult.pageNumber
              }
            },
            filePath: null,
          };

          await saveDocument(result);
          processedDocuments.push(result);
        }

        // Clean up
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        if (processedDocuments.length === 1) {
          return res.json(processedDocuments[0]);
        } else {
          return res.json({
            results: processedDocuments,
            processedCount: processedDocuments.length,
            multiDocument: true
          });
        }
      } catch (error) {
        console.error("❌ PDF processing error:", error);

        // Clean up on error
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        return res.status(500).json({
          error: 'PDF processing failed',
          details: error.message
        });
      }
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
    
    // Generate CSV content with professional format (extracted data only)
    const csvData: string[][] = [
      ['Supplier Name', document.supplier || 'Not found'],
      ['PO Number', document.poNumber || 'Not found'],
      ['PR Number', document.prNumber || 'Not found'],
      ['Project Number', document.projectNumber || 'Not found'],
      ['Job Number', document.jobNumber || 'Not found'],
      ['DO Number', document.doNumber || document.extractedData?.deliveryNumber || 'Not found'],
      ['Date', document.date || 'Not found'],
      ['Delivery Date', document.extractedData?.deliveryDate || 'Not found'],
      [''],
      ['Items Delivered'],
      ['Total Items Found', document.extractedData?.items?.length?.toString() || '0'],
      ['']
    ];

    // Add items table if available
    if (document.extractedData?.items && document.extractedData.items.length > 0) {
      // Check if items are in new object format or old string format
      const firstItem = document.extractedData.items[0];
      const isObjectFormat = typeof firstItem === 'object';

      if (isObjectFormat) {
        // New format with parsed data
        csvData.push(['S/N', 'Part Number', 'Description', 'Quantity', 'UOM']);
        document.extractedData.items.forEach((item: any) => {
          csvData.push([
            item.sn || '',
            item.partNumber || '',
            item.description || '',
            item.quantity || '',
            item.uom || ''
          ]);
        });
      } else {
        // Old format - just raw strings
        csvData.push(['#', 'Item Description']);
        document.extractedData.items.forEach((item: string, index: number) => {
          csvData.push([(index + 1).toString(), item]);
        });
      }
    } else {
      csvData.push(['No items found']);
    }

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
