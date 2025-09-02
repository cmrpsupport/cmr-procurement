import { ImageAnnotatorClient } from '@google-cloud/vision';
import fs from 'fs';
import path from 'path';

interface GoogleVisionConfig {
  projectId: string;
  keyFilename?: string;
}

interface ExtractedDocumentData {
  supplier: string;
  poNumber: string;
  projectNumber: string;
  date: string;
  deliveryDate?: string;
  totalAmount?: string;
  items?: string[];
  pageCount?: number;
  documentType?: string;
  confidence?: number;
  rawData?: any;
}

export class GoogleVisionDocumentService {
  private client: ImageAnnotatorClient;
  private projectId: string;

  constructor(config: GoogleVisionConfig) {
    this.projectId = config.projectId;
    
    // Initialize Google Vision API client
    this.client = new ImageAnnotatorClient({
      projectId: config.projectId,
      keyFilename: config.keyFilename,
    });
  }

  /**
   * Process document using Google Vision API OCR and custom data extraction
   */
  async processDocument(filePath: string, fileName: string): Promise<ExtractedDocumentData> {
    try {
      console.log(`Processing document with Google Vision AI: ${fileName}`);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Read the file
      const fileBuffer = fs.readFileSync(filePath);
      
      // Perform OCR using Google Vision API
      console.log('Calling Google Vision API for document text detection...');
      const [result] = await this.client.documentTextDetection({
        image: { content: fileBuffer },
        imageContext: {
          languageHints: ['en'], // English language hint
        },
      });

      const fullTextAnnotation = result.fullTextAnnotation;
      const extractedText = fullTextAnnotation?.text || '';
      
      if (!extractedText || extractedText.trim().length === 0) {
        console.log('No text extracted from document');
        throw new Error('No text could be extracted from the document');
      }
      
      console.log(`Google Vision API extracted ${extractedText.length} characters`);
      console.log('First 500 characters:', extractedText.substring(0, 500));

      // Extract structured data from the text using our pattern matching
      const extractedData = this.extractDataFromText(extractedText);
      
      // Add confidence score from Google Vision API
      const confidence = this.calculateConfidenceScore(fullTextAnnotation);
      
      // Determine page count
      const pageCount = fullTextAnnotation?.pages?.length || 1;

      const result_data: ExtractedDocumentData = {
        ...extractedData,
        pageCount,
        documentType: this.detectDocumentType(extractedText),
        confidence,
        rawData: {
          originalText: extractedText,
          visionApiResponse: fullTextAnnotation,
          fileName,
          fileSize: fileBuffer.length
        }
      };

      console.log('Google Vision processing completed:', result_data);
      return result_data;
      
    } catch (error) {
      console.error('Google Vision document processing error:', error);
      throw new Error(`Failed to process document with Google Vision AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract structured data from OCR text using pattern matching
   */
  private extractDataFromText(text: string): ExtractedDocumentData {
    console.log("=== EXTRACTING DATA FROM GOOGLE VISION TEXT ===");
    
    const extractedData: ExtractedDocumentData = {
      supplier: "",
      poNumber: "",
      projectNumber: "",
      date: "",
      deliveryDate: "",
      totalAmount: "",
      items: [],
      pageCount: 1,
    };

    try {
      // Extract supplier name with comprehensive patterns
      const supplierPatterns = [
        /supplier[:\s]+([^\n\r,;]+)/i,
        /vendor[:\s]+([^\n\r,;]+)/i,
        /company[:\s]+([^\n\r,;]+)/i,
        /delivered by[:\s]+([^\n\r,;]+)/i,
        /from[:\s]+([^\n\r,;]+)/i,
        /([A-Z][A-Za-z\s&.,]+(?:Pte\s+Ltd|Private\s+Limited|Pvt\s+Ltd|Inc|Corp|Ltd|LLC|Co)\.?)/i,
        /^([A-Z][A-Za-z\s&.,]+(?:Electronic|Electronics|Industries|Trading|Services|Solutions|Supply|Engineering|Technology|Systems)[A-Za-z\s.,]*)/im,
      ];

      for (const pattern of supplierPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const supplier = match[1].trim().replace(/[:\s]+$/, '');
          if (supplier.length > 2 && supplier.length < 100) {
            extractedData.supplier = supplier;
            break;
          }
        }
      }

      // Extract PO Number
      const poPatterns = [
        /your\s+order\s+no\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
        /po\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
        /purchase\s*order\s*#?[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
        /order\s*number[:\s]*([a-zA-Z0-9\-_\/]{3,20})/i,
        /\b(PO\d{4,10})\b/i,
        /p\.?o\.?\s*:?\s*([a-zA-Z0-9\-_\/]{3,20})/i,
      ];

      for (const pattern of poPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const poNumber = match[1].trim();
          if (poNumber.length >= 3 && poNumber.length <= 20) {
            extractedData.poNumber = poNumber;
            break;
          }
        }
      }

      // Extract Project Number - ONLY when there's a clear project/job label
      const projectPatterns = [
        /project\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /project\s*#[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /project[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /job\s*number[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /job\s*#[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /job[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /your\s*(?:ref|reference|job)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /(?:project|job)\s*(?:ref|reference|code)[:\s]*([a-zA-Z0-9\-_\/]{2,20})/i,
        /\b(PRJ[-_]?[a-zA-Z0-9]{2,15})\b/i,
        /\b(JOB[-_]?[a-zA-Z0-9]{2,15})\b/i,
        /\b(PROJ[-_]?[a-zA-Z0-9]{2,15})\b/i,
      ];

      for (const pattern of projectPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          let projectNumber = match[1].trim();
          if (projectNumber.length >= 2 && projectNumber.length <= 20) {
            extractedData.projectNumber = projectNumber;
            break;
          }
        }
      }

      // Extract dates
      const datePatterns = [
        /date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
        /delivery\s*date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
        /order\s*date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
        /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/g,
      ];

      const allDates: string[] = [];
      for (const pattern of datePatterns) {
        const matches = text.match(pattern);
        if (matches) {
          if (pattern.toString().includes('delivery')) {
            extractedData.deliveryDate = matches[1]?.trim();
          } else if (!extractedData.date) {
            extractedData.date = matches[1]?.trim();
          }
          matches.forEach(match => {
            if (match && /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(match)) {
              allDates.push(match);
            }
          });
        }
      }

      if (!extractedData.date && allDates.length > 0) {
        extractedData.date = allDates[0];
        if (!extractedData.deliveryDate && allDates.length > 1) {
          extractedData.deliveryDate = allDates[1];
        }
      }

      // Extract total amount
      const amountPatterns = [
        /total\s*amount[:\s]*([S$₱$€£¥]?\s*[0-9,]+\.?[0-9]*)/i,
        /grand\s*total[:\s]*([S$₱$€£¥]?\s*[0-9,]+\.?[0-9]*)/i,
        /total[:\s]*([S$₱$€£¥]?\s*[0-9,]+\.?[0-9]*)/i,
        /(S\$\s*[0-9,]+\.?[0-9]*)/g,
        /(SGD\s*[0-9,]+\.?[0-9]*)/g,
      ];

      for (const pattern of amountPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const amount = match[1].trim();
          const cleanAmount = amount.replace(/[S₱$€£¥,\s]|SGD/g, '');
          const numericAmount = parseFloat(cleanAmount);
          if (!isNaN(numericAmount) && numericAmount > 0) {
            let currency = 'S$'; // Default to Singapore Dollar
            if (amount.includes('S$') || amount.includes('SGD')) currency = 'S$';
            else if (amount.includes('₱')) currency = '₱';
            else if (amount.includes('$') && !amount.includes('S$')) currency = '$';
            else if (amount.includes('€')) currency = '€';
            else if (amount.includes('£')) currency = '£';
            else if (amount.includes('¥')) currency = '¥';
            
            extractedData.totalAmount = `${currency}${numericAmount.toLocaleString()}`;
            break;
          }
        }
      }

      // Extract items from the document
      extractedData.items = this.extractItems(text);

      console.log('Google Vision data extraction completed:', extractedData);
      return extractedData;

    } catch (error) {
      console.error('Error during data extraction:', error);
      return extractedData;
    }
  }

  /**
   * Extract items/products from the document text
   */
  private extractItems(text: string): string[] {
    const items: string[] = [];
    const lines = text.split('\n');

    // Product/item keywords to look for
    const productKeywords = [
      'conductor', 'disconnect', 'test', 'tb', 'jumper', 'switching', 'lever',
      'locking', 'cover', 'end', 'plate', 'terminal', 'block', 'relay', 
      'switch', 'connector', 'cable', 'wire', 'module', 'sensor', 'adapter',
      'fuse', 'breaker', 'contactor', 'transformer'
    ];

    let inItemSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.length < 3) continue;
      
      // Detect start of items section
      if (!inItemSection && (
        line.toLowerCase().includes('description') ||
        line.toLowerCase().includes('item') ||
        line.toLowerCase().includes('product') ||
        line.match(/qty.*delivered/i)
      )) {
        inItemSection = true;
        continue;
      }
      
      // Stop if we hit signature or end sections
      if (inItemSection && (
        line.toLowerCase().includes('signature') ||
        line.toLowerCase().includes('customer') ||
        line.toLowerCase().includes('received in good') ||
        line.toLowerCase().includes('terms')
      )) {
        break;
      }
      
      if (inItemSection) {
        // Look for product descriptions
        const isProductLine = productKeywords.some(keyword => 
          line.toLowerCase().includes(keyword.toLowerCase())
        ) && !/^[\d\-\s()]+$/.test(line) && !line.includes('@');
        
        if (isProductLine) {
          let item = line;
          // Clean up the item description
          item = item.replace(/^\d+\/[\d\-]+\s*\([^)]+\)\s*\d*\s*/g, '');
          item = item.replace(/\s+\d+\s*PC\s*\d+\s*PC.*$/i, '');
          item = item.trim();
          
          if (item.length > 3 && !items.includes(item)) {
            items.push(item);
          }
        }
      }
      
      if (items.length >= 8) break; // Limit to reasonable number
    }

    return items;
  }

  /**
   * Calculate confidence score from Google Vision API response
   */
  private calculateConfidenceScore(fullTextAnnotation: any): number {
    if (!fullTextAnnotation || !fullTextAnnotation.pages) {
      return 0.8; // Default confidence
    }

    let totalConfidence = 0;
    let wordCount = 0;

    for (const page of fullTextAnnotation.pages) {
      if (page.blocks) {
        for (const block of page.blocks) {
          if (block.paragraphs) {
            for (const paragraph of block.paragraphs) {
              if (paragraph.words) {
                for (const word of paragraph.words) {
                  if (word.confidence !== undefined) {
                    totalConfidence += word.confidence;
                    wordCount++;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (wordCount === 0) {
      return 0.8; // Default if no confidence scores available
    }

    return Math.round((totalConfidence / wordCount) * 100) / 100;
  }

  /**
   * Detect document type from text content
   */
  private detectDocumentType(text: string): string {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('delivery order') || lowerText.includes('delivery note')) {
      return 'delivery_order';
    }
    if (lowerText.includes('invoice') || lowerText.includes('bill')) {
      return 'invoice';
    }
    if (lowerText.includes('purchase order')) {
      return 'purchase_order';
    }
    if (lowerText.includes('receipt')) {
      return 'receipt';
    }
    if (lowerText.includes('quotation') || lowerText.includes('quote')) {
      return 'quotation';
    }
    
    return 'document';
  }

  /**
   * Test connection to Google Vision API
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing Google Vision API connection...');
      
      // Create a small test image (1x1 pixel)
      const testImageBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);

      const [result] = await this.client.textDetection({
        image: { content: testImageBuffer },
      });

      console.log('Google Vision API connection successful');
      return true;
    } catch (error) {
      console.error('Google Vision API connection test failed:', error);
      return false;
    }
  }
}

// Factory function to create Google Vision service instance
export function createGoogleVisionService(): GoogleVisionDocumentService {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  if (!projectId) {
    throw new Error('Google Cloud Project ID not configured. Please set GOOGLE_CLOUD_PROJECT_ID environment variable.');
  }

  if (!keyFilename) {
    throw new Error('Google Application Credentials not configured. Please set GOOGLE_APPLICATION_CREDENTIALS environment variable.');
  }

  return new GoogleVisionDocumentService({
    projectId,
    keyFilename
  });
}