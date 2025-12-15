/**
 * Extraction Enhancements - Helper functions to improve data extraction accuracy
 */

/**
 * OCR Common Error Corrections
 * Maps frequently misread characters to their correct values
 */
export const OCR_CORRECTIONS: Record<string, string> = {
  // Letter/Number confusions
  'O': '0',
  '0': 'O', // Context-dependent
  'l': '1',
  'I': '1',
  '|': '1',
  'Z': '2',
  'S': '5',
  'G': '6',
  'B': '8',
  'Q': '0',

  // Common word corrections
  'PTELTD': 'PTE LTD',
  'Ptc Ltd': 'Pte Ltd',
  'Ple Ltd': 'Pte Ltd',
  'L1d': 'Ltd',
  'Lt d': 'Ltd',
  'lnc': 'Inc',
  'C0': 'CO',
  'C0.': 'CO.',
};

/**
 * Apply OCR corrections to text based on context
 */
export function applyOCRCorrections(text: string, context: 'company' | 'number' | 'general'): string {
  let corrected = text;

  if (context === 'company') {
    // Company name corrections
    corrected = corrected.replace(/PTELTD/gi, 'PTE LTD');
    corrected = corrected.replace(/Ptc\s+Ltd/gi, 'Pte Ltd');
    corrected = corrected.replace(/Ple\s+Ltd/gi, 'Pte Ltd');
    corrected = corrected.replace(/L1d/g, 'Ltd');
    corrected = corrected.replace(/lnc/gi, 'Inc');
  } else if (context === 'number') {
    // Number corrections (O -> 0, etc.)
    corrected = corrected.replace(/O/g, '0');
    corrected = corrected.replace(/l/g, '1');
    corrected = corrected.replace(/\|/g, '1');
    corrected = corrected.replace(/S/g, '5');
  }

  return corrected;
}

/**
 * Validate if a supplier name looks legitimate
 */
export function validateSupplierName(name: string): { valid: boolean; confidence: number; issues: string[] } {
  const issues: string[] = [];
  let confidence = 1.0;

  // Check minimum length
  if (name.length < 5) {
    issues.push('Name too short (< 5 characters)');
    confidence -= 0.3;
  }

  // Must have at least some letters
  const letterCount = (name.match(/[a-zA-Z]/g) || []).length;
  if (letterCount < 3) {
    issues.push('Too few letters');
    confidence -= 0.4;
  }

  // Should not be mostly numbers
  const digitCount = (name.match(/\d/g) || []).length;
  if (digitCount > letterCount) {
    issues.push('More digits than letters');
    confidence -= 0.3;
  }

  // Should not contain common non-supplier words
  const invalidKeywords = [
    'customer', 'signature', 'stamp', 'chop', 'seal',
    'date', 'page', 'total', 'registration', 'address',
    'freight', 'delivery', 'invoice', 'gst'
  ];

  for (const keyword of invalidKeywords) {
    if (name.toLowerCase().includes(keyword)) {
      issues.push(`Contains invalid keyword: ${keyword}`);
      confidence -= 0.5;
    }
  }

  // Should contain company indicators
  const companyIndicators = ['pte', 'ltd', 'limited', 'inc', 'corp', 'company', 'co', 'enterprise', 'trading', 'supply'];
  const hasIndicator = companyIndicators.some(indicator =>
    name.toLowerCase().includes(indicator)
  );

  if (!hasIndicator) {
    issues.push('No company indicator found');
    confidence -= 0.2;
  }

  return {
    valid: confidence > 0.5,
    confidence: Math.max(0, Math.min(1, confidence)),
    issues
  };
}

/**
 * Validate if a PO number looks legitimate
 */
export function validatePONumber(po: string): { valid: boolean; confidence: number; issues: string[] } {
  const issues: string[] = [];
  let confidence = 1.0;

  // Should start with PO or P
  if (!po.match(/^P[O0]?/i)) {
    issues.push('Does not start with PO');
    confidence -= 0.3;
  }

  // Should have digits
  const digitCount = (po.match(/\d/g) || []).length;
  if (digitCount < 4) {
    issues.push('Too few digits (< 4)');
    confidence -= 0.4;
  }

  // Should not be all letters or all numbers
  const letterCount = (po.match(/[a-zA-Z]/g) || []).length;
  if (letterCount === 0 || digitCount === 0) {
    issues.push('Should contain both letters and numbers');
    confidence -= 0.3;
  }

  // Length check (typical PO: 7-10 characters)
  if (po.length < 5 || po.length > 15) {
    issues.push(`Unusual length: ${po.length}`);
    confidence -= 0.2;
  }

  return {
    valid: confidence > 0.5,
    confidence: Math.max(0, Math.min(1, confidence)),
    issues
  };
}

/**
 * Validate if a date looks legitimate
 */
export function validateDate(date: string): { valid: boolean; confidence: number; issues: string[] } {
  const issues: string[] = [];
  let confidence = 1.0;

  // Common date patterns
  const datePatterns = [
    /^\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]\d{4}$/,  // DD/MM/YYYY
    /^\d{4}[\.\/\-]\d{1,2}[\.\/\-]\d{1,2}$/,  // YYYY-MM-DD
    /^\d{1,2}\s+\w{3}\s+\d{4}$/i,             // DD MMM YYYY
    /^\w{3}\s+\d{1,2},?\s+\d{4}$/i            // MMM DD, YYYY
  ];

  const matchesPattern = datePatterns.some(pattern => pattern.test(date));
  if (!matchesPattern) {
    issues.push('Does not match common date patterns');
    confidence -= 0.5;
  }

  // Extract year and validate
  const yearMatch = date.match(/20\d{2}/);
  if (yearMatch) {
    const year = parseInt(yearMatch[0]);
    const currentYear = new Date().getFullYear();

    // Should be within reasonable range (2020-2030)
    if (year < 2020 || year > 2030) {
      issues.push(`Year out of expected range: ${year}`);
      confidence -= 0.3;
    }

    // Future dates are suspicious (more than 1 year ahead)
    if (year > currentYear + 1) {
      issues.push(`Date too far in future: ${year}`);
      confidence -= 0.2;
    }
  } else {
    issues.push('Could not extract valid year');
    confidence -= 0.4;
  }

  return {
    valid: confidence > 0.5,
    confidence: Math.max(0, Math.min(1, confidence)),
    issues
  };
}

/**
 * Extract table structure from lines
 * Identifies header row and data rows
 */
export function detectTableStructure(lines: string[]): {
  headerIndex: number;
  headers: string[];
  dataStartIndex: number;
  columnPositions: number[];
} | null {

  // Common table headers in delivery orders
  const headerKeywords = [
    's/n', 'sn', 'no', 'item', 'description', 'desc',
    'qty', 'quantity', 'part', 'uom', 'unit', 'price'
  ];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].toLowerCase();

    // Count how many header keywords are in this line
    const keywordCount = headerKeywords.filter(keyword =>
      line.includes(keyword)
    ).length;

    // If line contains at least 3 header keywords, it's likely a table header
    if (keywordCount >= 3) {
      // Extract headers by splitting on multiple spaces
      const headers = lines[i].split(/\s{2,}/).filter(h => h.trim().length > 0);

      // Find column positions (for alignment)
      const columnPositions: number[] = [];
      let lastIndex = 0;
      headers.forEach(header => {
        const index = lines[i].indexOf(header, lastIndex);
        if (index !== -1) {
          columnPositions.push(index);
          lastIndex = index + header.length;
        }
      });

      return {
        headerIndex: i,
        headers: headers.map(h => h.trim()),
        dataStartIndex: i + 1,
        columnPositions
      };
    }
  }

  return null;
}

/**
 * Clean and normalize extracted text
 */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/\r\n/g, '\n')         // Normalize line breaks
    .replace(/\r/g, '\n')           // Normalize line breaks
    .trim();
}

/**
 * Calculate confidence score for extraction results
 */
export function calculateExtractionConfidence(result: any): number {
  let score = 0;
  let maxScore = 0;

  // Critical fields (40 points each)
  const criticalFields = ['supplier', 'poNumber', 'date'];
  criticalFields.forEach(field => {
    maxScore += 40;
    if (result[field] && result[field] !== 'Not found') {
      score += 40;
    }
  });

  // Important fields (10 points each)
  const importantFields = ['doNumber', 'prNumber', 'jobNumber'];
  importantFields.forEach(field => {
    maxScore += 10;
    if (result[field] && result[field] !== 'Not found') {
      score += 10;
    }
  });

  // Items (20 points)
  maxScore += 20;
  if (result.items && Array.isArray(result.items) && result.items.length > 0) {
    score += 20;
  }

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Fuzzy match for company names (handles OCR errors)
 */
export function fuzzyMatchCompany(text: string, knownCompanies: string[]): string | null {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const company of knownCompanies) {
    const normalizedCompany = company.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Simple similarity check (Levenshtein distance could be used for better matching)
    if (normalizedText.includes(normalizedCompany.substring(0, Math.min(8, normalizedCompany.length)))) {
      return company;
    }
  }

  return null;
}

/**
 * Extract structured data from table rows
 */
export function parseTableRow(
  line: string,
  columnPositions: number[],
  headers: string[]
): Record<string, string> {
  const row: Record<string, string> = {};

  for (let i = 0; i < headers.length; i++) {
    const start = columnPositions[i];
    const end = i < columnPositions.length - 1 ? columnPositions[i + 1] : line.length;

    const value = line.substring(start, end).trim();
    row[headers[i].toLowerCase()] = value;
  }

  return row;
}
