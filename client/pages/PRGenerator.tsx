import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileText,
  Upload,
  ShoppingCart,
  Settings,
  ArrowLeft,
  CheckCircle,
  Clock,
  AlertCircle,
  X,
  Loader2,
  Edit,
  Download,
  Eye,
  Save,
  FileDown
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import * as XLSX from 'xlsx';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

interface BOMItem {
  partNumber: string;
  description: string;
  quantity: number;
  supplier: string;
  symbol?: string;
  drawingNumber?: string;
  revision?: string;
  requestedDate?: string;
  remarks?: string;
  unitPrice?: number;
  totalPrice?: number;
  rowIndex: number;
  sheetName?: string;
  isAccessory?: boolean; // Flag to identify accessory items
  mainItemPartNumber?: string; // Link accessories to their parent main item
}

interface PurchaseRequisition {
  id: string;
  supplier: string;
  items: BOMItem[];
  totalItems: number;
  totalValue: number;
  status: "Draft" | "Review" | "Approved";
  createdAt: string;
  prNumber: string;
}

const steps = [
  {
    title: "Upload BOM",
    description: "Upload your Bill of Materials (Excel/XLSB or CSV)",
    icon: Upload,
    status: "pending"
  },
  {
    title: "Review Sorting",
    description: "Verify automatic supplier assignments",
    icon: Settings,
    status: "pending"
  },
  {
    title: "Generate PRs",
    description: "Create formatted purchase requisitions",
    icon: ShoppingCart,
    status: "pending"
  },
  {
    title: "Finalize",
    description: "Review and approve for sending",
    icon: CheckCircle,
    status: "pending"
  }
];

export default function PRGenerator() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [purchaseRequisitions, setPurchaseRequisitions] = useState<PurchaseRequisition[]>([]);
  const [selectedPR, setSelectedPR] = useState<PurchaseRequisition | null>(null);
  const [showPRDialog, setShowPRDialog] = useState(false);
  const [editingPR, setEditingPR] = useState<PurchaseRequisition | null>(null);
  const [downloadingPR, setDownloadingPR] = useState<string | null>(null);
  const [downloadingPRPDF, setDownloadingPRPDF] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clear any cached data immediately when component mounts
  useEffect(() => {
    localStorage.removeItem('purchase-requisitions');
    setPurchaseRequisitions([]);
    setCurrentStep(1);
        setIsLoadingData(false);
  }, []);

  // Always start fresh - no loading of old data
  useEffect(() => {
    localStorage.removeItem('purchase-requisitions');
    setPurchaseRequisitions([]);
    setCurrentStep(1);
    setIsLoadingData(false);
  }, []);

  const handleFileSelect = (file: File) => {
    // Check file type - Excel, CSV, and PDF formats supported
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/vnd.ms-excel.sheet.binary.macroenabled.12', // .xlsb
      'text/csv', // .csv
      'application/pdf' // .pdf
    ];

    const fileName = file.name.toLowerCase();
    const allowedExtensions = ['.xlsx', '.xls', '.xlsb', '.csv', '.pdf'];
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!allowedTypes.includes(file.type) && !hasValidExtension) {
      setUploadError("Invalid file format. Please upload an Excel (.xlsx, .xls, .xlsb), CSV, or PDF file.");
      return;
    }

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File size must be less than 10MB");
      return;
    }

    setSelectedFile(file);
    setUploadError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setUploadError("");
    setProcessedData(null);
    setCurrentStep(1);
    setPurchaseRequisitions([]);
    // Clear any cached data from localStorage
    localStorage.removeItem('purchase-requisitions');
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Configure PDF.js worker
  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }, []);

  // PDF table extraction function - now returns pages separately
  const extractTablesFromPDF = async (fileBuffer: ArrayBuffer): Promise<{ pageData: any[][][], totalPages: number }> => {
    const pdf = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
    const pageData: any[][][] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by their Y position (rows)
      const rowMap = new Map<number, any[]>();

      textContent.items.forEach((item: any) => {
        if (item.str.trim()) {
          const y = Math.round(item.transform[5]); // Y coordinate
          const x = Math.round(item.transform[4]); // X coordinate

          if (!rowMap.has(y)) {
            rowMap.set(y, []);
          }
          rowMap.get(y)!.push({
            text: item.str.trim(),
            x: x
          });
        }
      });

      // Sort rows by Y coordinate (top to bottom)
      const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);

      // Convert to 2D array, sorting items within each row by X coordinate
      const pageRows: any[][] = [];
      sortedYs.forEach(y => {
        const rowItems = rowMap.get(y)!.sort((a, b) => a.x - b.x);
        const rowTexts = rowItems.map(item => item.text);

        // Only add rows that have multiple columns (likely table data)
        if (rowTexts.length > 1) {
          pageRows.push(rowTexts);
        }
      });

      pageData.push(pageRows);
    }

    return { pageData, totalPages: pdf.numPages };
  };

  const processBOMFile = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setUploadError("");
    const startTime = Date.now();

          try {
        const data = await selectedFile.arrayBuffer();

        let workbook: any;
        let jsonDataArray: any[][][] = [];

        // Handle different file types
        if (selectedFile.name.toLowerCase().endsWith('.pdf')) {
          // Process PDF
          const pdfResult = await extractTablesFromPDF(data);

          // Create a mock workbook structure for PDF data with separate pages
          const sheetNames = pdfResult.pageData.map((_, index) => `PDF_Page_${index + 1}`);
          workbook = {
            SheetNames: sheetNames,
            Sheets: {}
          };

          // Create sheet placeholders and data array
          sheetNames.forEach(sheetName => {
            workbook.Sheets[sheetName] = {}; // Placeholder
          });

          jsonDataArray = pdfResult.pageData;
        } else {
          // Process Excel/CSV files as before
          workbook = XLSX.read(data, { type: 'array' });

          // Convert each sheet to JSON data
          jsonDataArray = workbook.SheetNames.map(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            return XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          });
        }
        
        console.log('Available sheets:', workbook.SheetNames);
        console.log('Workbook structure:', workbook.Workbook);

        // Log sheet visibility info for debugging
        if (workbook.Workbook && workbook.Workbook.Sheets) {
          workbook.Workbook.Sheets.forEach((sheetInfo, index) => {
            const sheetName = workbook.SheetNames[index];
            console.log(`Sheet "${sheetName}" - Hidden: ${sheetInfo.Hidden}, Name: ${sheetInfo.name}`);
          });
        }

        // Function to find header row in a sheet's data
        const findHeaderRowInSheet = (sheetData: any[][]): { headerRow: number, headers: string[] } | null => {
          // Check up to the first 10 rows for headers
          for (let rowIdx = 0; rowIdx < Math.min(10, sheetData.length); rowIdx++) {
            const row = sheetData[rowIdx];
            if (!row || row.length === 0) continue;
            
            const rowHeaders = row.map(cell => cell?.toString() || '');
            const hasMaker = rowHeaders.some(h => h.toLowerCase().includes('maker') || h.toLowerCase().includes('make') || h.toLowerCase().includes('supplier'));
            const hasPartNumber = rowHeaders.some(h => h.toLowerCase().includes('model') || h.toLowerCase().includes('part'));
            
            console.log(`Checking row ${rowIdx + 1}:`, {
              rowHeaders,
              hasMaker,
              hasPartNumber
            });
            
            // Additional validation: check if this looks like a real header row
            // Headers should be mostly text, not numbers or mixed content
            const isLikelyHeader = rowHeaders.every(header => {
              // Handle undefined/null values safely
              if (!header || header === null || header === undefined) return true;
              
              const headerStr = header.toString().toLowerCase().trim();
              // Skip empty cells
              if (!headerStr) return true;
              
              // More lenient validation - only reject obvious data patterns
              if (/^\d+$/.test(headerStr)) return false; // Pure numbers only
              if (headerStr.includes('@') || headerStr.includes('http')) return false; // Emails/URLs
              if (headerStr.length > 100) return false; // Very long text
              
              return true;
            });
            
            if (hasMaker && hasPartNumber && isLikelyHeader) {
              console.log(`Found BOM headers in row ${rowIdx + 1}:`, rowHeaders);
              return { headerRow: rowIdx, headers: rowHeaders };
            } else {
              console.log(`Row ${rowIdx + 1} rejected as header:`, {
                hasMaker,
                hasPartNumber,
                isLikelyHeader,
                rowHeaders
              });
            }
          }
          return null;
        };
        
        // Find all sheets with BOM format (has 'Maker' and 'Model / Part No.' columns)
        const validSheets: Array<{
          sheetName: string;
          worksheet: any;
          jsonData: any[][];
          headerInfo: { headerRow: number, headers: string[] };
        }> = [];
        
        // Check all sheets for BOM format (skip hidden sheets)
        for (let i = 0; i < workbook.SheetNames.length; i++) {
          const sheetName = workbook.SheetNames[i];
          const worksheet = workbook.Sheets[sheetName];

          // Skip hidden sheets - check workbook.Workbook.Sheets array for visibility info
          let isHidden = false;
          if (workbook.Workbook && workbook.Workbook.Sheets && workbook.Workbook.Sheets[i]) {
            const sheetInfo = workbook.Workbook.Sheets[i];
            isHidden = sheetInfo.Hidden === 1 || sheetInfo.Hidden === 2; // Hidden (1) or VeryHidden (2)
          }

          if (isHidden) {
            console.log(`Skipping hidden sheet "${sheetName}"`);
            continue;
          }

          const jsonData = jsonDataArray[i];
          const headerInfo = findHeaderRowInSheet(jsonData);

          if (headerInfo) {
            console.log(`Found BOM format in sheet "${sheetName}"`);
            validSheets.push({
              sheetName,
              worksheet: worksheet,
              jsonData,
              headerInfo
            });
          } else {
            console.log(`Sheet "${sheetName}" doesn't have BOM format, skipping...`);
          }
        }
        
        if (validSheets.length === 0) {
          throw new Error(`No BOM format found in any sheet. Looking for headers containing 'Maker/Make/Supplier' and 'Model/Part No.' columns. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
        
        console.log(`Processing ${validSheets.length} sheets with BOM data:`, validSheets.map(s => s.sheetName));

        // Helper function to detect drawing number and revision from footer
        const detectDrawingInfo = (jsonData: any[][]): { drawingNumber?: string, revision?: string } => {
          // Find the last row with BOM data
          let lastBOMRow = -1;
          for (let i = jsonData.length - 1; i >= 0; i--) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;

            const rowText = row.map(cell => cell ? cell.toString().toLowerCase() : '').join(' ');
            const looksBOMData = /\b(phoenix|bender|schneider|wago|idec)\b/i.test(rowText) ||
                                /\b\d+\s*(pcs?|ea|each|qty)\b/i.test(rowText) ||
                                /^[0-9]+\s/.test(rowText.trim());

            if (looksBOMData) {
              lastBOMRow = i;
              break;
            }
          }

          // Search for drawing number in the entire document
          let drawingNumber: string | undefined;
          let revision: string | undefined;

          // Method 1: Look for standalone "SUBCONTRACTOR DOCUMENT NUMBER:" label
          for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;

            // Check if any cell contains the subcontractor document number label
            for (let j = 0; j < row.length; j++) {
              const cell = row[j];
              if (!cell) continue;

              const cellStr = cell.toString().trim();

              // Check for "SUBCONTRACTOR DOCUMENT NUMBER:" (case insensitive)
              if (/subcontractor\s+document\s+number\s*:/i.test(cellStr)) {
                // Look for the drawing number in subsequent rows/cells
                // First check same row, other columns
                for (let k = j + 1; k < row.length; k++) {
                  if (row[k]) {
                    const candidateValue = row[k].toString().trim();
                    if (isValidDrawingNumber(candidateValue)) {
                      drawingNumber = candidateValue;
                      break;
                    }
                  }
                }

                // If not found in same row, check next few rows
                if (!drawingNumber) {
                  for (let nextRowIdx = i + 1; nextRowIdx < Math.min(i + 5, jsonData.length); nextRowIdx++) {
                    const nextRow = jsonData[nextRowIdx];
                    if (!nextRow) continue;

                    for (let cellIdx = 0; cellIdx < nextRow.length; cellIdx++) {
                      if (nextRow[cellIdx]) {
                        const candidateValue = nextRow[cellIdx].toString().trim();
                        if (isValidDrawingNumber(candidateValue)) {
                          drawingNumber = candidateValue;
                          break;
                        }
                      }
                    }
                    if (drawingNumber) break;
                  }
                }

                if (drawingNumber) break;
              }
            }
            if (drawingNumber) break;
          }

          // Method 2: Traditional footer structure (fallback)
          if (!drawingNumber) {
            const startSearchFrom = lastBOMRow + 1;
            let validFooterRow = -1;
            let docNoCol = -1;
            let revisionCol = -1;

            for (let i = startSearchFrom; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (!row || row.length === 0) continue;

              const rowText = row.map(cell => cell ? cell.toString().toLowerCase() : '').join(' ');

              // Skip rows that look like BOM data
              const looksBOMData = /\b(phoenix|bender|schneider|wago|idec)\b/i.test(rowText) ||
                                  /\b\d+\s*(pcs?|ea|each|qty)\b/i.test(rowText) ||
                                  /^[0-9]+\s/.test(rowText.trim());

              if (looksBOMData) continue;

              // Check for footer structure
              const hasDocumentTitle = rowText.includes('document title');
              const hasDocNo = rowText.includes('doc') && rowText.includes('no');
              const hasSubcontractorDoc = rowText.includes('subcontractor') && rowText.includes('document') && rowText.includes('number');
              const hasRevision = rowText.includes('revision');

              if (hasDocumentTitle && (hasDocNo || hasSubcontractorDoc) && hasRevision) {
                validFooterRow = i;

                // Find column positions
                for (let j = 0; j < row.length; j++) {
                  const cell = row[j];
                  if (!cell) continue;

                  const cellStr = cell.toString().toLowerCase().trim();
                  if ((cellStr.includes('doc') && cellStr.includes('no')) ||
                      (cellStr.includes('subcontractor') && cellStr.includes('document') && cellStr.includes('number'))) {
                    docNoCol = j;
                  }
                  if (cellStr.includes('revision')) {
                    revisionCol = j;
                  }
                }
                break;
              }
            }

            if (validFooterRow !== -1) {
              // Get data from next row
              const dataRowIndex = validFooterRow + 1;
              if (dataRowIndex < jsonData.length) {
                const dataRow = jsonData[dataRowIndex];

                // Extract drawing number
                if (docNoCol >= 0 && docNoCol < dataRow.length && dataRow[docNoCol]) {
                  const docValue = dataRow[docNoCol].toString().trim();
                  if (isValidDrawingNumber(docValue)) {
                    drawingNumber = docValue;
                  }
                }

                // Extract revision
                if (revisionCol >= 0 && revisionCol < dataRow.length && dataRow[revisionCol]) {
                  const revValue = dataRow[revisionCol].toString().trim();
                  const revMatch = revValue.match(/(?:REV\.?\s*)?(\d{1,2})/i);
                  if (revMatch) {
                    revision = revMatch[1].padStart(2, '0');
                  }
                }
              }
            }
          }

          // Helper function to validate drawing number patterns
          function isValidDrawingNumber(value: string): boolean {
            if (!value || typeof value !== 'string') return false;

            const trimmedValue = value.trim();
            if (trimmedValue.length < 5) return false; // Too short

            // Try multiple drawing number patterns
            const patterns = [
              /^\d{5}-\d{3}-\d{2}-\d{2}$/,    // XXXXX-XXX-XX-XX (like 25006-001-04-02)
              /^\d{4,6}-\d{2,4}-\d{2,3}-\d{2}$/, // Variable length
              /^[A-Z0-9]{2,6}-\d{3,4}-\d{2,3}-\d{2}$/, // Alphanumeric start
              /^\d{3,6}-\d{3}-\d{2}-\d{2}$/,   // Shorter start
              /^[A-Z]\d{4}-\d{3}-\d{2}-\d{2}$/ // Letter + numbers
            ];

            return patterns.some(pattern => pattern.test(trimmedValue));
          }

          return { drawingNumber, revision };
        };

        // First pass: collect all drawing numbers from all sheets
        const allDrawingNumbers: { [sheetName: string]: { drawingNumber?: string, revision?: string } } = {};

        for (let i = 0; i < workbook.SheetNames.length; i++) {
          const sheetName = workbook.SheetNames[i];
          const jsonData = jsonDataArray[i];
          const drawingInfo = detectDrawingInfo(jsonData);
          allDrawingNumbers[sheetName] = drawingInfo;
        }
        
        // Collect all unique drawing numbers found
        const foundDrawings = Object.entries(allDrawingNumbers)
          .filter(([_, info]) => info.drawingNumber)
          .map(([sheetName, info]) => ({ sheetName, ...info }));
        
        console.log('Drawing numbers found:', foundDrawings);
        
        // Use first found as fallback
        let fallbackDrawing: { drawingNumber?: string, revision?: string } = {};
        if (foundDrawings.length > 0) {
          fallbackDrawing = foundDrawings[0];
        }

        // Process data with multi-row support
        const itemsGrouped: { [key: string]: number } = {};
        const supplierItems: { [key: string]: BOMItem[] } = {};
        let totalItems = 0;
        let validItemsCount = 0;
        let skippedRowsCount = 0;
        const processedSheets: string[] = [];

        // Process all valid sheets
        for (const sheetInfo of validSheets) {
          const { sheetName, jsonData, headerInfo } = sheetInfo;
          const { headerRow, headers } = headerInfo;
          
          let sheetDrawingInfo = allDrawingNumbers[sheetName] || {};
          
          if (!sheetDrawingInfo.drawingNumber) {
            // Try to assign different drawings to different sheets intelligently
            const sheetIndex = validSheets.findIndex(s => s.sheetName === sheetName);
            if (foundDrawings.length > 1 && sheetIndex < foundDrawings.length) {
              // Assign different drawings to different sheets
              sheetDrawingInfo = foundDrawings[sheetIndex];
              console.log(`Smart assignment: Sheet "${sheetName}" gets drawing ${sheetDrawingInfo.drawingNumber}`);
            } else if (fallbackDrawing.drawingNumber) {
              sheetDrawingInfo = fallbackDrawing;
            }
          }

          if (jsonData.length < headerRow + 2) {
            console.log(`Skipping sheet "${sheetName}": no data rows found`);
            continue;
          }

          const dataRows = jsonData.slice(headerRow + 1) as any[][];
          
          console.log('Total data rows to process:', dataRows.length);
          console.log('First 5 data rows:', dataRows.slice(0, 5));
          
          // Debug: Check for empty rows
          const nonEmptyRows = dataRows.filter(row => row && row.length > 0 && !row.every(cell => !cell || cell.toString().trim() === ''));
          console.log('Non-empty data rows:', nonEmptyRows.length);

          // Find column indices with flexible matching for this sheet
          const findColumnIndex = (searchTerms: string[]): number => {
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i];
          // Handle undefined/null values safely
          if (!header) continue;
          
          const headerStr = header.toString().toLowerCase().trim();
          for (const term of searchTerms) {
            // First try exact match
            if (headerStr === term.toLowerCase()) {
              return i;
            }
            // Then try if the header contains the term
            if (headerStr.includes(term.toLowerCase())) {
              return i;
            }
          }
        }
            return -1;
          };

          const qtyCol = findColumnIndex(['qty', ' qty', 'quantity', 'amount']);
          const symbolCol = findColumnIndex(['symbol', 'tag', 'reference']);
          const descriptionCol = findColumnIndex(['description', 'desc', 'name']);
          const makerCol = findColumnIndex(['maker', 'make', 'supplier', 'vendor', 'manufacturer']);
          console.log('Maker column detection:', {
            headers: headers,
            makerCol: makerCol,
            foundHeader: makerCol !== -1 ? headers[makerCol] : 'Not found'
          });
          const partNumberCol = findColumnIndex(['model / part no.', 'model / part no', 'model/part no', 'part number', 'part no']);
          const remarksCol = findColumnIndex(['remarks', 'notes', 'comments']);

          console.log('Column indices:', {
            qty: qtyCol,
            symbol: symbolCol,
            description: descriptionCol,
            maker: makerCol,
            partNumber: partNumberCol,
            remarks: remarksCol
          });

          if (makerCol === -1 || partNumberCol === -1) {
            console.log(`Sheet "${sheetName}" missing required columns. Need 'Maker/Make/Supplier' and 'Model / Part No.' columns. Found: ${headers.join(', ')}`);
            continue;
          }

          // Track this sheet as processed
          processedSheets.push(sheetName);

          // Process rows with multi-line description support
          let currentMainItemPartNumber: string | null = null; // Track the current main item
          
          for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        
        // Skip empty rows
        if (!row || row.length === 0 || row.every(cell => !cell || cell.toString().trim() === '')) {
          skippedRowsCount++;
          continue;
        }

        const qty = qtyCol !== -1 ? parseFloat(row[qtyCol]) || 1 : 1;
        const symbol = symbolCol !== -1 ? row[symbolCol]?.toString().trim() : '';
        let description = descriptionCol !== -1 ? row[descriptionCol]?.toString().trim() : '';
        const maker = makerCol !== -1 ? row[makerCol]?.toString().trim() : '';
        const partNumber = partNumberCol !== -1 ? row[partNumberCol]?.toString().trim() : '';
        let remarks = remarksCol !== -1 ? row[remarksCol]?.toString().trim() : '';
        
        // Skip rows where the maker value is actually a header name
        if (maker && headers.some(header => header && header.toString().toLowerCase().includes(maker.toLowerCase()))) {
          console.log(`Skipping row ${i + headerRow + 2}: maker value "${maker}" is a header name`);
          skippedRowsCount++;
          continue;
        }
        
        // Debug: Log when "Maker" is found as a data value
        if (maker && maker.toLowerCase().includes('maker')) {
          console.log(`WARNING: Found "Maker" as data value in row ${i + headerRow + 2}:`, {
            row: row,
            makerCol: makerCol,
            maker: maker,
            headers: headers
          });
        }

        console.log(`Row ${i + headerRow + 2}:`, { qty, symbol, description, maker, partNumber });

        // Check if this is an accessory (description starts with "(number)")
        const isAccessory = /^\(\d+\)/.test(description.trim());

        // Check if this is a main item (has both maker and part number AND is not an accessory)
        const isMainItem = maker && partNumber && !isAccessory;

        console.log(`Item check for row ${i + headerRow + 2}:`, {
          maker: `"${maker}"`,
          partNumber: `"${partNumber}"`,
          description: `"${description.substring(0, 50)}..."`,
          isAccessory: isAccessory,
          isMainItem: isMainItem,
          makerExists: !!maker,
          partNumberExists: !!partNumber
        });

        if (isMainItem) {
          console.log(`✓ Processing as main item: ${partNumber} by ${maker}`);
          console.log(`Looking for continuation rows starting from row ${i + 1 + headerRow + 2}...`);
          
          // This is a main item, check for continuation rows (multi-line descriptions)
          const continuationDescriptions: string[] = [];
          let nextRowIndex = i + 1;
          
          // Look ahead for continuation rows
          while (nextRowIndex < dataRows.length) {
            const nextRow = dataRows[nextRowIndex];
            
            // Skip completely empty rows
            if (!nextRow || nextRow.length === 0 || nextRow.every(cell => !cell || cell.toString().trim() === '')) {
              break;
            }
            
            const nextMaker = makerCol !== -1 ? nextRow[makerCol]?.toString().trim() : '';
            const nextPartNumber = partNumberCol !== -1 ? nextRow[partNumberCol]?.toString().trim() : '';
            const nextDescription = descriptionCol !== -1 ? nextRow[descriptionCol]?.toString().trim() : '';
            
            console.log(`Checking potential continuation row ${nextRowIndex + headerRow + 2}:`, {
              nextMaker: `"${nextMaker}"`,
              nextPartNumber: `"${nextPartNumber}"`,
              nextDescription: `"${nextDescription}"`,
              makerEmpty: !nextMaker,
              partNumberEmpty: !nextPartNumber,
              hasDescription: !!nextDescription
            });
            
            // Check if this is a continuation row (empty or whitespace-only maker and part number but has description)
            const isContinuationRow = (!nextMaker || nextMaker === '') && 
                                    (!nextPartNumber || nextPartNumber === '') && 
                                    nextDescription && nextDescription !== '';
            
            if (isContinuationRow) {
              console.log(`✓ Found continuation row ${nextRowIndex + headerRow + 2}: "${nextDescription}"`);
              continuationDescriptions.push(nextDescription);
              nextRowIndex++;
            } else {
              console.log(`✗ Not a continuation row ${nextRowIndex + headerRow + 2}: has maker="${nextMaker}" or partNumber="${nextPartNumber}"`);
              // Hit a new main item or empty row, stop looking
              break;
            }
          }
          
          // Merge descriptions if we found continuation rows
          if (continuationDescriptions.length > 0) {
            const fullDescription = [description, ...continuationDescriptions].join('\n');
            description = fullDescription;
            console.log(`✓ Merged multi-line description for ${partNumber}:`, {
              originalDescription: `"${description.split('\n')[0]}"`,
              continuationLines: continuationDescriptions,
              finalDescription: `"${description}"`,
              totalLines: description.split('\n').length
            });
          } else {
            console.log(`No continuation rows found for ${partNumber}, keeping single-line description: "${description}"`);
          }
          
          // Update the current main item tracker
          currentMainItemPartNumber = partNumber;
          console.log(`📋 New main item detected: ${partNumber}`);

          // Now create the BOM item with the potentially merged description
          const item: BOMItem = {
            partNumber,
            supplier: maker,
            description: description || 'No description',
            quantity: qty,
            symbol: symbol || '',
            remarks,
            unitPrice: 0, // Default to 0, user will enter manually
            rowIndex: i + headerRow + 2,
            sheetName,
            isAccessory: false,
            mainItemPartNumber: undefined,
            drawingNumber: sheetDrawingInfo.drawingNumber,
            revision: sheetDrawingInfo.revision
          };
          item.totalPrice = item.unitPrice! * item.quantity;
          
          
          addItemToGroups(item);
          validItemsCount++;
          
          // Skip the continuation rows we already processed
          i = nextRowIndex - 1; // -1 because the for loop will increment
          console.log(`Processed main item and skipping to row ${nextRowIndex + headerRow + 2}`);
        } else if (isAccessory && maker && partNumber) {
          // This is an accessory with its own part number and maker
          console.log(`✓ Processing as accessory: ${partNumber} by ${maker} | Main Item: ${currentMainItemPartNumber}`);

          const item: BOMItem = {
            partNumber,
            supplier: maker,
            description: description || 'No description',
            quantity: qty,
            symbol: symbol || '',
            remarks,
            unitPrice: 0, // Default to 0, user will enter manually
            rowIndex: i + headerRow + 2,
            sheetName,
            isAccessory: true,
            mainItemPartNumber: currentMainItemPartNumber,
            drawingNumber: sheetDrawingInfo.drawingNumber,
            revision: sheetDrawingInfo.revision
          };
          item.totalPrice = item.unitPrice! * item.quantity;

          addItemToGroups(item);
          validItemsCount++;
        } else if (maker && !partNumber && description) {
          // Skip items with maker but no part number - they need manual review
          skippedRowsCount++;
          console.log(`⚠️ Skipping row ${i + headerRow + 2}: has maker (${maker}) and description but no part number - needs manual review`);
        } else {
          skippedRowsCount++;
          console.log(`⚠️ Skipping row ${i + headerRow + 2}: missing maker (found: ${maker || 'none'}) or part number (found: ${partNumber || 'none'}) - insufficient information`);
        }
          }
          
          console.log(`Sheet "${sheetName}" processing summary:`, {
            totalDataRows: dataRows.length,
            validItemsFromSheet: processedSheets.filter(s => s === sheetName).length,
            skippedRowsFromSheet: skippedRowsCount
          });
        }

        // Helper functions (moved outside sheet loop)
        function addItemToGroups(item: BOMItem) {
          if (!itemsGrouped[item.supplier]) {
            itemsGrouped[item.supplier] = 0;
            supplierItems[item.supplier] = [];
          }

          // Always add items individually - no combination at this level
          // The combination logic is only for display totals in exports
          itemsGrouped[item.supplier]++;
          supplierItems[item.supplier].push(item);
          totalItems++;
        }


        console.log('Multi-sheet processing summary:', {
          totalSheetsProcessed: processedSheets.length,
          processedSheets: processedSheets,
          validItemsCount,
          skippedRowsCount,
          totalItems,
          totalSuppliersFound: Object.keys(itemsGrouped).length
        });

        if (totalItems === 0) {
          throw new Error(`No valid items found in any BOM sheets. 
          Processed ${processedSheets.length} sheets: ${processedSheets.join(', ')}
          Found ${validItemsCount} valid items, skipped ${skippedRowsCount} rows.
          Make sure your BOM sheets have data rows with both 'Model / Part No.' and 'Maker' columns filled.
          Check the browser console for detailed debugging information.`);
        }

      const processingTimeSeconds = (Date.now() - startTime) / 1000;
      const processingTime = processingTimeSeconds < 1
        ? `${(processingTimeSeconds * 1000).toFixed(0)}ms`
        : `${processingTimeSeconds.toFixed(1)}s`;

      // Try to save BOM file to database, but continue if it fails
      let bomFileId = `local-${Date.now()}`;
      
      try {
      const bomFileResponse = await fetch('/api/bom/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          totalItems,
          suppliersFound: Object.keys(itemsGrouped).length,
          processingTime: processingTime
        })
      });

        if (bomFileResponse.ok) {
      const bomFile = await bomFileResponse.json();
          bomFileId = bomFile.id;

      // Save BOM items to database
      const bomItems = Object.values(supplierItems).flat();
          await fetch('/api/bom/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bomFileId: bomFile.id,
          items: bomItems
        })
      });
        } else {
          console.log('Database not available, using local processing');
        }
      } catch (dbError) {
        console.log('Database not available, using local processing:', dbError);
      }


      const processedData = {
        id: bomFileId,
        totalItems,
        suppliersFound: Object.keys(itemsGrouped).length,
        itemsGrouped,
        supplierItems,
        processingTime: processingTime,
        status: "success",
        fileName: selectedFile.name,
        fileSize: (selectedFile.size / 1024).toFixed(1) + ' KB',
        sheetsProcessed: processedSheets,
        totalSheetsProcessed: processedSheets.length,
        totalSheetsInFile: workbook.SheetNames.length,
        columnsFound: {
          partNumber: '✓ Found in processed sheets',
          supplier: '✓ Found in processed sheets', 
          description: '✓ Found in processed sheets',
          quantity: '✓ Found in processed sheets',
          symbol: '✓ Found in processed sheets',
          remarks: '✓ Found in processed sheets'
        }
      };

      setProcessedData(processedData);
      setCurrentStep(2);

    } catch (error) {
      console.error('Processing error:', error);
      setUploadError(error instanceof Error ? error.message : "Failed to process BOM file. Please check the file format and try again.");
    } finally {
      setIsProcessing(false);
    }
  };


  // Helper function to calculate bundle totals for display
  const calculateBundleTotals = (items: BOMItem[]) => {
    const bundleTotals = new Map<string, number>();
    const firstOccurrenceIndex = new Map<string, number>();

    // Calculate total quantities for each bundle (main items and accessories)
    items.forEach((item, index) => {
      let bundleKey: string;

      if (item.isAccessory) {
        // For accessories, use combination of main item part number and accessory details
        bundleKey = `${item.mainItemPartNumber}|${item.partNumber}|${item.description}`;
      } else {
        // For main items, use part number and description
        bundleKey = `${item.partNumber}|${item.description}`;
      }

      const current = bundleTotals.get(bundleKey) || 0;
      bundleTotals.set(bundleKey, current + item.quantity);

      // Record the first occurrence index
      if (!firstOccurrenceIndex.has(bundleKey)) {
        firstOccurrenceIndex.set(bundleKey, index);
      }
    });

    return { bundleTotals, firstOccurrenceIndex };
  };

  // Helper function to group bundle items together
  const groupBundleItems = (items: BOMItem[]): BOMItem[] => {
    const groupedItems: BOMItem[] = [];

    // Process items in their original order to preserve bundle structure
    let i = 0;
    while (i < items.length) {
      const currentItem = items[i];

      if (!currentItem.isAccessory) {
        // This is a main item - start a new bundle
        groupedItems.push(currentItem);

        // Find all accessories that belong to this main item and come after it
        const mainItemPartNumber = currentItem.partNumber;
        let j = i + 1;
        const bundleAccessories: BOMItem[] = [];

        // Look ahead for accessories that belong to this main item
        while (j < items.length) {
          const nextItem = items[j];

          if (nextItem.isAccessory && nextItem.mainItemPartNumber === mainItemPartNumber) {
            bundleAccessories.push(nextItem);
            j++;
          } else if (!nextItem.isAccessory) {
            // Hit another main item, stop looking
            break;
          } else {
            // Hit an accessory for a different main item, stop looking
            break;
          }
        }

        // Sort accessories by their (1), (2), (3) numbers
        bundleAccessories.sort((a, b) => {
          const aMatch = a.description.match(/^\((\d+)\)/);
          const bMatch = b.description.match(/^\((\d+)\)/);

          if (aMatch && bMatch) {
            return parseInt(aMatch[1]) - parseInt(bMatch[1]);
          }
          return a.description.localeCompare(b.description);
        });

        // Add all accessories for this bundle instance
        bundleAccessories.forEach(accessory => {
          groupedItems.push(accessory);
        });

        // Skip over the accessories we just processed
        i = j;
      } else {
        // This is an orphaned accessory (shouldn't happen with proper processing)
        groupedItems.push(currentItem);
        i++;
      }
    }

    return groupedItems;
  };

  const generatePurchaseRequisitions = async () => {
    if (!processedData) return;

    try {
      const prs: PurchaseRequisition[] = Object.entries(processedData.supplierItems).map(([supplier, items], index) => {
        const itemsArray = items as BOMItem[];

        // Group bundle items together
        const groupedItems = groupBundleItems(itemsArray);

        const totalValue = groupedItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

        return {
          id: Date.now().toString() + index,
          supplier,
          items: groupedItems,
          totalItems: groupedItems.length,
          totalValue,
          status: "Draft" as const,
          createdAt: new Date().toLocaleString(),
          prNumber: `PR-${new Date().getFullYear()}-${String(index + 1).padStart(3, '0')}`
        };
      });

      // Try to save PRs to database, but fall back to local storage if it fails
      try {
      const response = await fetch('/api/purchase-requisitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bomFileId: processedData.id,
          purchaseRequisitions: prs
        })
      });

        if (response.ok) {
      const savedPRs = await response.json();
      setPurchaseRequisitions(savedPRs);
        } else {
          // Fallback to local processing if API fails
          console.log('Database API not available, using local storage');
          localStorage.setItem('purchase-requisitions', JSON.stringify(prs));
          setPurchaseRequisitions(prs);
        }
      } catch (apiError) {
        // Fallback to local processing if API fails
        console.log('Database API not available, using local storage:', apiError);
        localStorage.setItem('purchase-requisitions', JSON.stringify(prs));
        setPurchaseRequisitions(prs);
      }

      setCurrentStep(3);
    } catch (error) {
      console.error('Error generating purchase requisitions:', error);
      setUploadError('Failed to generate purchase requisitions. Please try again.');
    }
  };

  const openPR = (pr: PurchaseRequisition) => {
    setSelectedPR(pr);
    setShowPRDialog(true);
  };

  const editPR = (pr: PurchaseRequisition) => {
    setEditingPR({ ...pr });
    setShowPRDialog(true);
  };

  const savePR = async () => {
    if (!editingPR) return;

    // Validate required fields
    if (!editingPR.prNumber.trim()) {
      setUploadError('PR Number is required');
      return;
    }

    // Clear any previous errors
    setUploadError('');

    try {
      // Try to save to API first
    try {
      const response = await fetch(`/api/purchase-requisitions/${editingPR.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prNumber: editingPR.prNumber,
          supplier: editingPR.supplier,
          totalItems: editingPR.items.length,
          totalValue: editingPR.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0),
          status: editingPR.status,
          items: editingPR.items
        })
      });

        if (response.ok) {
      const updatedPR = await response.json();
      setPurchaseRequisitions(prev => 
        prev.map(pr => pr.id === editingPR.id ? updatedPR : pr)
      );
        } else {
          // Fallback to local storage
          const updatedPRs = purchaseRequisitions.map(pr => 
            pr.id === editingPR.id ? editingPR : pr
          );
          setPurchaseRequisitions(updatedPRs);
          localStorage.setItem('purchase-requisitions', JSON.stringify(updatedPRs));
        }
      } catch (apiError) {
        // Fallback to local storage
        console.log('API not available, saving to local storage:', apiError);
        const updatedPRs = purchaseRequisitions.map(pr => 
          pr.id === editingPR.id ? editingPR : pr
        );
        setPurchaseRequisitions(updatedPRs);
        localStorage.setItem('purchase-requisitions', JSON.stringify(updatedPRs));
      }

      setEditingPR(null);
      setShowPRDialog(false);
    } catch (error) {
      console.error('Error saving purchase requisition:', error);
      setUploadError('Failed to save purchase requisition. Please try again.');
    }
  };

  const updateItem = (itemIndex: number, field: keyof BOMItem, value: any) => {
    if (!editingPR) return;

    const updatedItems = [...editingPR.items];
    updatedItems[itemIndex] = { ...updatedItems[itemIndex], [field]: value };
    
    // Recalculate total price
    if (field === 'quantity' || field === 'unitPrice') {
      const item = updatedItems[itemIndex];
      item.totalPrice = (item.unitPrice || 0) * item.quantity;
    }

    setEditingPR({
      ...editingPR,
      items: updatedItems,
      totalItems: updatedItems.length,
      totalValue: updatedItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0)
    });
  };

  const downloadTemplate = () => {
    // Create BOM template matching customer's exact format
    const templateData = [
      // Header row matching customer's template exactly
      ['Qty', 'Symbol', 'Description', 'Maker', 'Model / Part No.', 'Remarks'],
      
      // Sample data matching customer's format and components
      [3, '11h1, 11h2, 11h3', '(Ø22mm) Pilot Light, Red c/w 230V LED Bulb, Red', 'Schneider', 'ZB4-BV04+ZB4-BV6', ''],
      [3, '', 'c/w 230V LED Bulb, Red', 'Mecomb', 'MSLED230-R', ''],
      [1, '11j1', '(Ø22mm) illuminated Momentary Pushbutton, Red c/w.1NO+1NC.Contact', 'Schneider', 'ZB4-BW34+ZB4-BW065', ''],
      [1, '', 'c/w. 220~240V AC LED, Red', 'Mecomb', 'MSLED230 R', ''],
      [1, '11j2', '(Ø22mm) illuminated Momentary Pushbutton, Green c/w.1NO+1NC.Contact', 'Schneider', 'ZB4-BW33+ZB4-BW065', ''],
      [1, '', 'c/w. 220~240V AC LED, Green', 'Mecomb', 'MSLED230 G', ''],
      [1, '11j17', '(Ø22mm) illuminated Momentary Pushbutton, Yellow c/w.1NO+1NC.Contact', 'Schneider', 'ZB4-BW35+ZB4-BW065', ''],
      [1, '', 'c/w. 220~240V AC LED, Yellow', 'Mecomb', 'MSLED230 Y', ''],
      [5, '11d1~11d5', '3A Aux. Relay, 4PDT, 230VAC c/w Socket', 'Idec', 'RN4S-NL-AC230+SN4S-05D', ''],
      [5, '', '& Hold Down Spring', 'Idec', 'SFA-502', ''],
      
      // Additional electrical components
      [2, '11k1, 11k2', '1600AF/1600AT,3P ACB, 42kA (415V AC) Drawout Type, c/w', 'Schneider', 'MTZ1 16H1/LV847240', 'Main Incomer'],
      [1, '', 'Micrologic 2.0X Control Unit', 'Schneider', 'LV847281', ''],
      [4, '11m1~11m4', '800AF/720AT, 3P MCCB, 50kA(380/415V), Drawout Type', 'Schneider', 'NS800N/33330', 'Feeder Protection'],
      [2, '', 'Micrologic 2.0 Trip Unit', 'Schneider', '33504', ''],
      [8, '11n1~11n8', '630AF/630AT, 4P4d MCCB, 36kA (380/415V)', 'Schneider', 'NSX630F', 'Motor Protection']
    ];

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(templateData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'BOM Template');

    // Generate and download file
    XLSX.writeFile(wb, 'BOM_Template.xlsx');
  };

  const downloadPRPDF = async (pr: PurchaseRequisition) => {
    console.log('Downloading PR as PDF:', pr);
    console.log('PDF export - PR items count:', pr.items.length);
    setDownloadingPRPDF(pr.id);
    
    try {
      // Read the existing PDF template
      const templatePath = '/PR Export Template.pdf';
      const existingPdfBytes = await fetch(templatePath).then(res => {
        if (!res.ok) {
          throw new Error('Could not load PDF template');
        }
        return res.arrayBuffer();
      });
      
      // Load the existing PDF
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      
      // Get standard font
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Fill in the header fields based on template coordinates
      
      // VENDOR field - aligned with PR Date and PR Number level
      firstPage.drawText(pr.supplier, {
        x: 120,
        y: 580,
        size: 10,
        font: font,
        color: rgb(0, 0, 0),
      });
      
      // PR Date - in the PR Date box
      firstPage.drawText(new Date().toLocaleDateString('en-GB'), {
        x: 535,
        y: 580,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });
      
      // P.R. NO - in the P.R. NO box
      firstPage.drawText(pr.prNumber, {
        x: 630,
        y: 580,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });
      
      // Table starting Y position (based on actual template) - move higher
      const tableStartY = 520;
      const rowHeight = 16; // Optimal spacing for text positioning above lines
      
      // Simple fixed chunking - 6 items per page to prevent overflow
      const itemsPerPage = 6;
      const itemChunks = [];
      for (let i = 0; i < pr.items.length; i += itemsPerPage) {
        itemChunks.push(pr.items.slice(i, i + itemsPerPage));
      }
      
      // Process each page of items
      let finalCurrentY = tableStartY;
      
      for (let pageIndex = 0; pageIndex < itemChunks.length; pageIndex++) {
        const items = itemChunks[pageIndex];
        let currentPage;
        
        if (pageIndex === 0) {
          currentPage = firstPage;
        } else {
          // Create new page by copying the template
          const newPageBytes = await fetch('/PR Export Template.pdf').then(res => res.arrayBuffer());
          const templateDoc = await PDFDocument.load(newPageBytes);
          const [templatePage] = await pdfDoc.copyPages(templateDoc, [0]);
          currentPage = pdfDoc.addPage(templatePage);
          
          // Update header info on new page
          currentPage.drawText(pr.supplier, {
            x: 120,
            y: 580,
            size: 10,
            font: font,
            color: rgb(0, 0, 0),
          });
          
          currentPage.drawText(new Date().toLocaleDateString('en-GB'), {
            x: 535,
            y: 580,
            size: 9,
            font: font,
            color: rgb(0, 0, 0),
          });
          
          currentPage.drawText(pr.prNumber, {
            x: 630,
            y: 580,
            size: 9,
            font: font,
            color: rgb(0, 0, 0),
          });
        }
        
        // Column X positions - balance the alignment
        const columns = {
          item: 45,         // Item column (centered)
          drawingNo: 68,    // Drawing No. (moved 27 units left total)
          rev: 155,         // Rev (moved 20 units right total)
          description: 190, // Description
          maker: 440,       // Maker - pull back to the left
          modelPart: 500,   // Model/Part No.
          sub: 630,         // Sub (Qty) - keep the good position
          total: 675,       // Total (Qty) - moved 50 units to the right
          unitPrice: 715,   // Unit Price - moved 40 units to the right total (30+10)
          dateReq: 750,     // Date Required
          remarks: 810      // Remarks - adjusted to 810 (10 points back from 800)
        };
        
        // Dynamic text measurement and positioning utilities
        const measureTextWidth = (text: string, fontSize: number) => {
          // More accurate character width calculation based on font size
          const avgCharWidth = fontSize * 0.55; // Slightly more accurate than 0.6
          return text.length * avgCharWidth;
        };

        const formatTextWithDynamicPositioning = (
          text: string, 
          startX: number, 
          maxWidth: number, 
          fontSize: number = 8, 
          horizontalMargin: number = 20
        ) => {
          if (!text || typeof text !== 'string') {
            return { 
              lines: [''], 
              fontSize, 
              lineHeight: 16, 
              actualWidth: 0,
              nextXPosition: startX 
            };
          }

          // First split by existing newlines to preserve multi-line structure
          const existingLines = text.split('\n');
          const lines: string[] = [];
          let maxActualWidth = 0;

          // Process each existing line separately
          for (const existingLine of existingLines) {
            const words = existingLine.trim().split(' ');
            let currentLine = '';
            let currentLineWidth = 0;

            for (const word of words) {
              const testLine = currentLine ? `${currentLine} ${word}` : word;
              const testLineWidth = measureTextWidth(testLine, fontSize);
              
              // Check if adding this word would exceed the maximum width
              if (testLineWidth <= maxWidth) {
                currentLine = testLine;
                currentLineWidth = testLineWidth;
              } else {
                // Current line is full, push it and start new line
                if (currentLine) {
                  lines.push(currentLine);
                  maxActualWidth = Math.max(maxActualWidth, currentLineWidth);
                }
                
                // Handle very long single words that don't fit
                if (measureTextWidth(word, fontSize) > maxWidth) {
                  // Break the word with hyphenation
                  let remainingWord = word;
                  while (remainingWord.length > 0) {
                    let breakPoint = remainingWord.length;
                    
                    // Find the longest substring that fits
                    for (let i = 1; i <= remainingWord.length; i++) {
                      const testSubstring = remainingWord.substring(0, i) + (i < remainingWord.length ? '-' : '');
                      if (measureTextWidth(testSubstring, fontSize) > maxWidth) {
                        breakPoint = Math.max(1, i - 1); // At least 1 character
                        break;
                      }
                    }
                    
                    const linePart = remainingWord.substring(0, breakPoint) + (breakPoint < remainingWord.length ? '-' : '');
                    lines.push(linePart);
                    maxActualWidth = Math.max(maxActualWidth, measureTextWidth(linePart, fontSize));
                    remainingWord = remainingWord.substring(breakPoint);
                  }
                  currentLine = '';
                  currentLineWidth = 0;
                } else {
                  // Start new line with current word
                  currentLine = word;
                  currentLineWidth = measureTextWidth(word, fontSize);
                }
              }
            }

            // Push the final line for this existing line
            if (currentLine) {
              lines.push(currentLine);
              maxActualWidth = Math.max(maxActualWidth, currentLineWidth);
            }
          }

          const nextXPosition = startX + maxActualWidth + horizontalMargin;

          return {
            lines: lines.length > 0 ? lines : [''],
            fontSize,
            lineHeight: 16,
            actualWidth: maxActualWidth,
            nextXPosition: nextXPosition
          };
        };

        // Configuration for horizontal spacing
        const textConfig = {
          horizontalMargin: 25, // Configurable margin between fields
          columnMaxWidths: {
            description: 240,
            maker: 55,
            partNumber: 120,
            remarks: 150 // Increased from 60 to 150 for full text display
          }
        };
        
        // Draw items for this page aligned with existing template grid
        let currentY = tableStartY;
        
        items.forEach((item, index) => {
          const globalIndex = pageIndex * itemsPerPage + index;
          
          // Calculate dynamic positioning for each field
          let currentXPosition = columns.description;
          
          const descriptionFormat = formatTextWithDynamicPositioning(
            item.description || '', 
            currentXPosition, 
            textConfig.columnMaxWidths.description, 
            8, 
            textConfig.horizontalMargin
          );
          currentXPosition = Math.min(descriptionFormat.nextXPosition, columns.maker); // Don't exceed maker column
          
          const makerFormat = formatTextWithDynamicPositioning(
            item.supplier || '', 
            currentXPosition, 
            textConfig.columnMaxWidths.maker, 
            8, 
            textConfig.horizontalMargin
          );
          currentXPosition = Math.min(makerFormat.nextXPosition, columns.modelPart); // Don't exceed part number column
          
          const partNoFormat = formatTextWithDynamicPositioning(
            item.partNumber || '', 
            currentXPosition, 
            textConfig.columnMaxWidths.partNumber, 
            8, 
            textConfig.horizontalMargin
          );
          
          const remarksFormat = item.remarks ? formatTextWithDynamicPositioning(
            item.remarks, 
            columns.remarks, 
            textConfig.columnMaxWidths.remarks, 
            7, 
            textConfig.horizontalMargin
          ) : { lines: [''], fontSize: 7, lineHeight: 16, actualWidth: 0, nextXPosition: columns.remarks };
          
          // Find the maximum number of lines needed for this row
          const maxLines = Math.max(
            descriptionFormat.lines.length,
            makerFormat.lines.length,
            partNoFormat.lines.length,
            remarksFormat.lines.length,
            1 // Minimum 1 line
          );
          
          // Calculate actual row height based on content (restore original logic)
          const baseRowHeight = 20; // Base height for single line items
          const lineSpacing = 16; // Fixed 16pt spacing between lines
          const rowPadding = 8; // Additional padding between rows
          const actualRowHeight = baseRowHeight + ((maxLines - 1) * lineSpacing) + rowPadding;
          const yPos = currentY + 4; // Add 4 points offset to position text above the table lines
          
          // Item number
          currentPage.drawText((globalIndex + 1).toString(), {
            x: columns.item,
            y: yPos,
            size: 8,
            font: font,
            color: rgb(0, 0, 0),
          });
          
          // Drawing Number
          if (item.drawingNumber) {
            currentPage.drawText(item.drawingNumber, {
              x: columns.drawingNo,
              y: yPos,
              size: 8,
              font: font,
              color: rgb(0, 0, 0),
            });
          }

          // Revision
          if (item.revision) {
            currentPage.drawText(item.revision, {
              x: columns.rev,
              y: yPos,
              size: 8,
              font: font,
              color: rgb(0, 0, 0),
            });
          }
          
          // Description (multi-line) - dynamic positioning with proper spacing
          let descriptionStartX = columns.description;
          descriptionFormat.lines.forEach((line, lineIndex) => {
            if (line.trim()) {
              currentPage.drawText(line, {
                x: descriptionStartX,
                y: yPos - (lineIndex * 16),
                size: descriptionFormat.fontSize,
                font: font,
                color: rgb(0, 0, 0),
              });
            }
          });
          
          // Maker (supplier) - with boundary checking
          makerFormat.lines.forEach((line, lineIndex) => {
            if (line.trim()) {
              const textX = columns.maker;
              const textY = yPos - (lineIndex * 16);
              
              // Check if text would overflow into model/part column (starts at 500)
              const estimatedTextWidth = line.length * (makerFormat.fontSize * 0.6);
              const maxAllowedWidth = columns.modelPart - columns.maker - 10; // 10pt padding
              
              if (estimatedTextWidth > maxAllowedWidth) {
                const maxChars = Math.floor(maxAllowedWidth / (makerFormat.fontSize * 0.6)) - 3;
                const truncatedLine = line.substring(0, maxChars) + '...';
                currentPage.drawText(truncatedLine, {
                  x: textX,
                  y: textY,
                  size: makerFormat.fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                });
              } else {
                currentPage.drawText(line, {
                  x: textX,
                  y: textY,
                  size: makerFormat.fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                });
              }
            }
          });
          
          // Model / Part No. - with boundary checking
          partNoFormat.lines.forEach((line, lineIndex) => {
            if (line.trim()) {
              const textX = columns.modelPart;
              const textY = yPos - (lineIndex * 16);
              
              // Check if text would overflow into qty column (starts at 630)
              const estimatedTextWidth = line.length * (partNoFormat.fontSize * 0.6);
              const maxAllowedWidth = columns.sub - columns.modelPart - 10; // 10pt padding
              
              if (estimatedTextWidth > maxAllowedWidth) {
                const maxChars = Math.floor(maxAllowedWidth / (partNoFormat.fontSize * 0.6)) - 3;
                const truncatedLine = line.substring(0, maxChars) + '...';
                currentPage.drawText(truncatedLine, {
                  x: textX,
                  y: textY,
                  size: partNoFormat.fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                });
              } else {
                currentPage.drawText(line, {
                  x: textX,
                  y: textY,
                  size: partNoFormat.fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                });
              }
            }
          });
          
          // Quantity
          currentPage.drawText(item.quantity.toString(), {
            x: columns.sub,
            y: yPos,
            size: 8,
            font: font,
            color: rgb(0, 0, 0),
          });

          // Total - show bundle total only on first occurrence
          const { bundleTotals, firstOccurrenceIndex } = calculateBundleTotals(pr.items);
          let bundleKey: string;

          if (item.isAccessory) {
            bundleKey = `${item.mainItemPartNumber}|${item.partNumber}|${item.description}`;
          } else {
            bundleKey = `${item.partNumber}|${item.description}`;
          }

          const isFirstOccurrence = firstOccurrenceIndex.get(bundleKey) === globalIndex;
          if (isFirstOccurrence) {
            const totalQuantity = bundleTotals.get(bundleKey) || 0;
            currentPage.drawText(totalQuantity.toString(), {
              x: columns.total,
              y: yPos,
              size: 8,
              font: font,
              color: rgb(0, 0, 0),
            });
          }

          // Unit Price
          currentPage.drawText(`${(item.unitPrice || 0).toFixed(2)}`, {
            x: columns.unitPrice,
            y: yPos,
            size: 8,
            font: font,
            color: rgb(0, 0, 0),
          });
          
          // Remarks - display full text without truncation
          if (item.remarks) {
            remarksFormat.lines.forEach((line, lineIndex) => {
              if (line.trim()) {
                currentPage.drawText(line, {
                  x: columns.remarks,
                  y: yPos - (lineIndex * 16),
                  size: remarksFormat.fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                });
              }
            });
          }

          // Move to next row - dynamic spacing based on content
          currentY -= actualRowHeight;
        });
        
        // Store the final Y position from the last page
        if (pageIndex === itemChunks.length - 1) {
          finalCurrentY = currentY;
        }
      }
      
      // Add total on the last page
      const lastPageIndex = itemChunks.length - 1;
      const lastPage = pages[pages.length - 1];
      
      // Position total amount right next to the "Total:" text in the template
      // Based on the template, Total: appears in the table row above the signature section
      lastPage.drawText(`${pr.totalValue.toLocaleString()}`, {
        x: 680, // Right after the "Total:" text in the table
        y: 270, // Y position where the Total row appears in the table
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      
      // Serialize the PDF
      const pdfBytes = await pdfDoc.save();
      
      // Create download
      const blob = new Blob([pdfBytes.buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${pr.prNumber}_${pr.supplier.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      link.click();
      
      // Clean up
      URL.revokeObjectURL(url);
      
      console.log('PDF download completed successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please try again.');
    } finally {
      setDownloadingPRPDF(null);
    }
  };

  const downloadPR = (pr: PurchaseRequisition) => {
    console.log('Downloading PR (Excel):', pr);
    console.log('Excel export - PR items count:', pr.items.length);
    setDownloadingPR(pr.id);
    
    try {
      // Create PR data matching PDF template format
      const prData = [
        // Header row with company name
        ['CMR', '', '', '', '', '', '', '', '', '', ''],
        [],
        // Purchase Requisition title
        ['PURCHASE REQUISITION', '', '', '', '', '', '', '', '', '', ''],
        [],
        // Header information matching PDF layout
        ['VENDOR:', pr.supplier, '', '', 'PR Date:', new Date().toLocaleDateString('en-GB'), 'P.R. NO:', pr.prNumber, '', '', ''],
        [],
        // Table headers matching PDF template
        ['Item', 'Drawing No.', 'Rev', 'Description', 'Maker', 'Model / Part No.', 'Sub', 'Total', 'Unit Price', 'Date Required', 'Remarks'],
        
        // Items data with full data (no truncation)
        ...pr.items.map((item, index) => {
          // Calculate bundle totals for this item
          const { bundleTotals, firstOccurrenceIndex } = calculateBundleTotals(pr.items);
          let bundleKey: string;

          if (item.isAccessory) {
            bundleKey = `${item.mainItemPartNumber}|${item.partNumber}|${item.description}`;
          } else {
            bundleKey = `${item.partNumber}|${item.description}`;
          }

          const isFirstOccurrence = firstOccurrenceIndex.get(bundleKey) === index;
          const totalQuantity = isFirstOccurrence ? (bundleTotals.get(bundleKey) || 0) : '';

          return [
            index + 1,                    // Item
            item.drawingNumber || '',     // Drawing No.
            item.revision || '',          // Rev
            item.description,            // Description (full text)
            item.supplier,               // Maker (full text)
            item.partNumber,             // Model/Part No. (full text)
            item.quantity,               // Sub (Quantity)
            totalQuantity,               // Total (bundle total on first occurrence only)
            (item.unitPrice || 0).toFixed(2),  // Unit Price
            '',                          // Date Required
            item.remarks || ''           // Remarks (full text)
          ];
        }),
        
        // Empty row before total
        [],
        // Total row
        ['', '', '', '', '', '', '', '', `Total: ${pr.totalValue.toLocaleString()}`, '', '']
      ];

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(prData);

    // Set column widths matching PDF template layout
    const colWidths = [
      { wch: 6 },   // Item
      { wch: 12 },  // Drawing No.
      { wch: 6 },   // Rev
      { wch: 35 },  // Description
      { wch: 12 },  // Maker
      { wch: 18 },  // Model / Part No.
      { wch: 6 },   // Sub (Quantity)
      { wch: 8 },   // Total
      { wch: 12 },  // Unit Price
      { wch: 12 },  // Date Required
      { wch: 15 }   // Remarks
    ];
    ws['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Requisition');

      // Generate and download file
      const fileName = `${pr.prNumber}_${pr.supplier.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
      console.log('Generating file:', fileName);
      XLSX.writeFile(wb, fileName);
      console.log('Download completed successfully');
    } catch (error) {
      console.error('Error downloading PR:', error);
      alert('Error downloading Purchase Requisition. Please try again.');
    } finally {
      setDownloadingPR(null);
    }
  };

  // Show loading state while fetching data
  if (isLoadingData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-500" />
                     <p className="text-muted-foreground">Loading existing data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link to="/" className="flex items-center text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Home
              </Link>
              <div className="w-px h-6 bg-border"></div>
              <div className="flex items-center space-x-2">
                <FileText className="w-6 h-6 text-primary" />
                <span className="text-xl font-semibold text-foreground">Purchase Requisition Generator</span>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-foreground">Generate Purchase Requisitions</h1>
            <Badge variant="secondary">Step {currentStep} of 4</Badge>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index + 1 === currentStep;
              const isCompleted = index + 1 < currentStep;
              return (
                <Card key={index} className={`${isActive ? 'ring-2 ring-primary bg-primary/10' : ''} ${isCompleted ? 'bg-green-500/10' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isCompleted ? 'bg-green-500 text-white' : isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        {isCompleted ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{step.title}</div>
                        <div className="text-xs text-muted-foreground">{step.description}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Upload className="w-5 h-5" />
                    <span>Upload Bill of Materials</span>
                  </CardTitle>
                  <CardDescription>
                    Upload your BOM file to automatically generate purchase requisitions for each supplier
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                      isDragging
                        ? 'border-primary bg-primary/10'
                        : selectedFile
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border hover:border-primary'
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".xlsx,.xls,.xlsb,.csv,.pdf"
                      onChange={handleFileInputChange}
                    />

                    {selectedFile ? (
                      <div className="space-y-4">
                        <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                        <div className="space-y-2">
                                                     <h3 className="text-lg font-medium text-foreground">File Selected</h3>
                                                      <div className="bg-card border rounded-lg p-3 flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                                                               <FileText className="w-5 h-5 text-muted-foreground" />
                              <div className="text-left">
                                <div className="font-medium text-sm">{selectedFile.name}</div>
                                                                 <div className="text-xs text-muted-foreground">
                                  {(selectedFile.size / 1024).toFixed(1)} KB
                                </div>
                              </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={removeFile}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                          <Button
                            className="w-full"
                            onClick={processBOMFile}
                            disabled={isProcessing}
                          >
                            {isProcessing ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Processing...
                              </>
                            ) : (
                              'Process BOM File'
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                                                   <Upload className={`w-12 h-12 mx-auto ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div>
                             <h3 className="text-lg font-medium text-foreground mb-2">
                            {isDragging ? 'Drop your BOM file here' : 'Drag and drop your BOM file'}
                          </h3>
                                                       <p className="text-muted-foreground mb-4">or click to browse files</p>
                          <Button onClick={() => fileInputRef.current?.click()}>
                            Choose File
                          </Button>
                                                       <p className="text-xs text-muted-foreground mt-2">Supports Excel (.xlsx, .xls, .xlsb), CSV, and PDF files</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {uploadError && (
                                         <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                       <div className="flex items-center space-x-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4" />
                        <span>{uploadError}</span>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 space-y-3">
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                      <AlertCircle className="w-4 h-4" />
                      <span>Make sure your BOM includes columns for: Qty, Symbol, Description, Maker, Model/Part No., and Remarks</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                      <AlertCircle className="w-4 h-4" />
                      <span>For PDF files: Ensure the BOM is in a clear table format with proper column alignment</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Processing Results */}
            {processedData && currentStep >= 2 && (
              <Card className="border-green-500/30 bg-transparent">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-foreground">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>BOM Processing Complete</span>
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {processedData.fileName} ({processedData.fileSize}) has been successfully processed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* File Processing Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                      <div className="text-center p-3 bg-card rounded-lg border">
                        <div className="text-2xl font-bold text-foreground">{processedData.totalItems}</div>
                        <div className="text-sm text-muted-foreground">Total Items</div>
                    </div>
                      <div className="text-center p-3 bg-card rounded-lg border">
                                              <div className="text-2xl font-bold text-foreground">{processedData.suppliersFound}</div>
                        <div className="text-sm text-muted-foreground">Suppliers Found</div>
                    </div>
                      <div className="text-center p-3 bg-card rounded-lg border">
                        <div className="text-2xl font-bold text-foreground">{Object.keys(processedData.itemsGrouped).length}</div>
                        <div className="text-sm text-muted-foreground">PRs to Generate</div>
                    </div>
                      <div className="text-center p-3 bg-card rounded-lg border">
                        <div className="text-2xl font-bold text-foreground">{processedData.totalSheetsProcessed}</div>
                        <div className="text-sm text-muted-foreground">Sheets Processed</div>
                    </div>
                      <div className="text-center p-3 bg-card rounded-lg border">
                        <div className="text-2xl font-bold text-foreground">{processedData.processingTime}</div>
                        <div className="text-sm text-muted-foreground">Processing Time</div>
                    </div>
                  </div>


                  {/* Processed Sheets Info */}
                  {processedData.sheetsProcessed && processedData.sheetsProcessed.length > 0 && (
                    <div className="mb-6 p-4 bg-card rounded-lg border">
                      <h4 className="font-medium text-foreground mb-3">Processed Sheets ({processedData.totalSheetsProcessed} of {processedData.totalSheetsInFile}):</h4>
                      <div className="flex flex-wrap gap-2">
                        {processedData.sheetsProcessed.map((sheetName, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            📄 {sheetName}
                          </Badge>
                        ))}
                      </div>
                      {processedData.totalSheetsInFile > processedData.totalSheetsProcessed && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {processedData.totalSheetsInFile - processedData.totalSheetsProcessed} sheet(s) were skipped (no BOM format detected)
                        </p>
                      )}
                    </div>
                  )}

                  {/* Column Mapping Info */}
                  <div className="mb-6 p-4 bg-card rounded-lg border">
                    <h4 className="font-medium text-foreground mb-3">Successfully Detected Columns:</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center">
                        <span className="text-muted-foreground">Quantity Column:</span>
                        <span className="font-medium ml-2 text-foreground">{processedData.columnsFound.quantity}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-muted-foreground">Symbol Column:</span>
                        <span className="font-medium ml-2 text-foreground">{processedData.columnsFound.symbol}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-muted-foreground">Description Column:</span>
                        <span className="font-medium ml-2 text-foreground">{processedData.columnsFound.description}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-muted-foreground">Supplier Column:</span>
                        <span className="font-medium ml-2 text-foreground">{processedData.columnsFound.supplier}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-muted-foreground">Part Number Column:</span>
                        <span className="font-medium ml-2 text-foreground">{processedData.columnsFound.partNumber}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-muted-foreground">Remarks Column:</span>
                        <span className="font-medium ml-2 text-foreground">{processedData.columnsFound.remarks}</span>
                      </div>
                    </div>
                    <div className="mt-3 p-2 bg-transparent border border-green-500/30 rounded text-sm text-foreground">
                      ✅ All required columns detected successfully across {processedData.totalSheetsProcessed} sheet(s). BOM data combined from multiple sheets.
                    </div>
                  </div>

                  {/* Supplier Breakdown */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Items Grouped by Supplier:</h4>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {Object.entries(processedData.itemsGrouped)
                        .sort(([,a], [,b]) => (b as number) - (a as number))
                        .map(([supplier, count], index) => (
                        <div key={index} className="p-3 bg-card rounded-lg border hover:bg-muted/50">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium">{supplier}</span>
                            <Badge variant="secondary">{count as number} items</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {currentStep === 2 && (
                    <div className="mt-6 flex space-x-3">
                      <Button className="flex-1" onClick={generatePurchaseRequisitions}>
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        Generate Purchase Requisitions
                      </Button>
                      <Button variant="outline" onClick={removeFile}>
                        Process New BOM
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Generated PRs */}
            {purchaseRequisitions.length > 0 && currentStep >= 3 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <ShoppingCart className="w-5 h-5" />
                    <span>Generated Purchase Requisitions</span>
                    <Badge variant="secondary">{purchaseRequisitions.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Review and edit the generated purchase requisitions before finalizing
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {purchaseRequisitions.map((pr) => (
                      <div key={pr.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-medium text-foreground">{pr.supplier}</h4>
                            <p className="text-sm text-muted-foreground">{pr.prNumber} • {pr.totalItems} items</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant={pr.status === 'Draft' ? 'secondary' : 'outline'} className={pr.status === 'Approved' ? 'border-green-500/30 text-green-500' : ''}>
                              {pr.status}
                            </Badge>
                            {pr.status === 'Draft' ? (
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="text-green-600 border-green-600 hover:bg-green-50"
                                onClick={() => {
                                  const updatedPRs = purchaseRequisitions.map(p => 
                                    p.id === pr.id ? { ...p, status: 'Approved' as const } : p
                                  );
                                  setPurchaseRequisitions(updatedPRs);
                                }}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                            ) : (
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="text-orange-600 border-orange-600 hover:bg-orange-50"
                                onClick={() => {
                                  const updatedPRs = purchaseRequisitions.map(p => 
                                    p.id === pr.id ? { ...p, status: 'Draft' as const } : p
                                  );
                                  setPurchaseRequisitions(updatedPRs);
                                }}
                              >
                                <X className="w-4 h-4 mr-1" />
                                Unapprove
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => openPR(pr)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => editPR(pr)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => downloadPR(pr)}
                              disabled={downloadingPR === pr.id}
                              title="Download as Excel"
                            >
                              {downloadingPR === pr.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4" />
                              )}
                            </Button>
                            <Button 
                              size="sm" 
                              onClick={() => downloadPRPDF(pr)}
                              disabled={downloadingPRPDF === pr.id}
                              title="Download as PDF"
                            >
                              {downloadingPRPDF === pr.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <FileDown className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="text-sm text-gray-600">
                          Total Value: SGD {pr.totalValue.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {currentStep === 3 && (
                    <div className="mt-6 flex space-x-3">
                      <Button className="flex-1" onClick={() => setCurrentStep(4)}>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Proceed to Finalize
                      </Button>
                      <Button variant="outline" onClick={removeFile}>
                        Process New BOM
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 4: Finalize */}
            {currentStep === 4 && (
              <Card className="border-primary/30 bg-transparent">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-foreground">
                    <CheckCircle className="w-5 h-5 text-primary" />
                    <span>Finalize Purchase Requisitions</span>
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Review and approve your purchase requisitions for sending to suppliers
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="text-center p-3 bg-card rounded-lg border">
                      <div className="text-2xl font-bold text-foreground">{purchaseRequisitions.length}</div>
                      <div className="text-sm text-muted-foreground">Total PRs</div>
                    </div>
                    <div className="text-center p-3 bg-card rounded-lg border">
                      <div className="text-2xl font-bold text-foreground">
                        {purchaseRequisitions.reduce((sum, pr) => sum + pr.totalItems, 0)}
                      </div>
                      <div className="text-sm text-muted-foreground">Total Items</div>
                    </div>
                    <div className="text-center p-3 bg-card rounded-lg border">
                      <div className="text-2xl font-bold text-foreground">
                        SGD {purchaseRequisitions.reduce((sum, pr) => sum + pr.totalValue, 0).toLocaleString()}
                      </div>
                      <div className="text-sm text-muted-foreground">Total Value</div>
                    </div>
                    <div className="text-center p-3 bg-card rounded-lg border">
                      <div className="text-2xl font-bold text-foreground">
                        {purchaseRequisitions.filter(pr => pr.status === 'Draft').length}
                      </div>
                      <div className="text-sm text-muted-foreground">Pending Approval</div>
                    </div>
                  </div>

                  {/* PR Status Overview */}
                  <div className="mb-6 p-4 bg-card rounded-lg border">
                    <h4 className="font-medium text-foreground mb-3">Purchase Requisition Status:</h4>
                    <div className="space-y-2">
                      {purchaseRequisitions.map((pr) => (
                        <div key={pr.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                          <div className="flex items-center space-x-3">
                            <span className="font-medium text-sm">{pr.prNumber}</span>
                            <span className="text-muted-foreground">•</span>
                            <span className="text-sm text-muted-foreground">{pr.supplier}</span>
                            <Badge variant={pr.status === 'Draft' ? 'secondary' : 'outline'} className={`text-xs ${pr.status === 'Approved' ? 'border-green-500/30 text-green-500' : ''}`}>
                              {pr.status}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {pr.totalItems} items • SGD {pr.totalValue.toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-4">
                    <div className="flex space-x-3">
                      {purchaseRequisitions.some(pr => pr.status === 'Draft') ? (
                      <Button 
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => {
                          // Mark all PRs as approved
                          const approvedPRs = purchaseRequisitions.map(pr => ({ ...pr, status: 'Approved' as const }));
                          setPurchaseRequisitions(approvedPRs);
                          // Here you could also make API calls to update the database
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Approve All Purchase Requisitions
                      </Button>
                      ) : (
                        <Button 
                          className="flex-1 bg-orange-600 hover:bg-orange-700"
                          onClick={() => {
                            // Mark all PRs as draft (unapprove)
                            const draftPRs = purchaseRequisitions.map(pr => ({ ...pr, status: 'Draft' as const }));
                            setPurchaseRequisitions(draftPRs);
                            // Here you could also make API calls to update the database
                          }}
                        >
                          <X className="w-4 h-4 mr-2" />
                          Unapprove All Purchase Requisitions
                        </Button>
                      )}
                      <Button 
                        variant="outline"
                        onClick={() => {
                          // Download all PRs as Excel files
                          purchaseRequisitions.forEach(pr => downloadPR(pr));
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download All (Excel)
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => {
                          // Download all PRs as PDF files
                          purchaseRequisitions.forEach(pr => downloadPRPDF(pr));
                        }}
                      >
                        <FileDown className="w-4 h-4 mr-2" />
                        Download All (PDF)
                      </Button>
                    </div>
                    
                    <div className="flex space-x-3">
                      <Button variant="outline" onClick={() => setCurrentStep(3)}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Review
                      </Button>
                      <Button variant="outline" onClick={removeFile}>
                        Start New Process
                      </Button>
                    </div>
                  </div>

                  {/* Success Message */}
                  <div className="mt-6 p-4 bg-transparent border border-green-500/30 rounded-lg">
                    <div className="flex items-center space-x-2 text-sm text-foreground">
                      <CheckCircle className="w-4 h-4 text-green-500/70" />
                      <span>
                        Ready to send! Your purchase requisitions have been processed and are ready for supplier submission.
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">How it Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-medium text-primary">1</span>
                  </div>
                  <div>
                    <div className="font-medium text-sm">Upload BOM</div>
                    <div className="text-xs text-muted-foreground">System validates file format and structure</div>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-medium text-primary">2</span>
                  </div>
                  <div>
                    <div className="font-medium text-sm">AI Analysis</div>
                    <div className="text-xs text-muted-foreground">Smart field mapping, categorization, and supplier grouping</div>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-medium text-primary">3</span>
                  </div>
                  <div>
                    <div className="font-medium text-sm">Generate PRs</div>
                    <div className="text-xs text-muted-foreground">Creates formatted requisitions per supplier</div>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-medium text-primary">4</span>
                  </div>
                  <div>
                    <div className="font-medium text-sm">Review & Send</div>
                    <div className="text-xs text-muted-foreground">Make final edits and approve for sending</div>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>

      {/* PR Details Dialog */}
      <Dialog open={showPRDialog} onOpenChange={setShowPRDialog}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <FileText className="w-5 h-5" />
              <span>Purchase Requisition Details</span>
              {editingPR && <Badge variant="secondary">Editing</Badge>}
            </DialogTitle>
            <DialogDescription>
              {editingPR ? 'Edit the purchase requisition details' : 'Review the generated purchase requisition'}
            </DialogDescription>
          </DialogHeader>
          {(selectedPR || editingPR) && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">PR Number</label>
                  {editingPR ? (
                    <Input
                      value={editingPR.prNumber}
                      onChange={(e) => setEditingPR({ ...editingPR, prNumber: e.target.value })}
                      className="mt-1"
                    />
                  ) : (
                    <p className="text-sm text-foreground mt-1">{selectedPR!.prNumber}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Supplier</label>
                  <p className="text-sm text-foreground mt-1">{(editingPR || selectedPR)!.supplier}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Total Items</label>
                  <p className="text-sm text-foreground mt-1">{(editingPR || selectedPR)!.items.length}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Total Value</label>
                  <p className="text-sm text-foreground mt-1">SGD {(editingPR || selectedPR)!.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0).toLocaleString()}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">Items</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Drawing No.</TableHead>
                      <TableHead>Rev</TableHead>
                      <TableHead>Part Number</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(editingPR || selectedPR)!.items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          {editingPR ? (
                            <Input
                              value={item.symbol || ''}
                              onChange={(e) => updateItem(index, 'symbol', e.target.value)}
                              className="w-24"
                            />
                          ) : (
                            item.symbol || '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {editingPR ? (
                            <Input
                              value={item.drawingNumber || ''}
                              onChange={(e) => updateItem(index, 'drawingNumber', e.target.value)}
                              className="w-32"
                            />
                          ) : (
                            item.drawingNumber || '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {editingPR ? (
                            <Input
                              value={item.revision || ''}
                              onChange={(e) => updateItem(index, 'revision', e.target.value)}
                              className="w-20"
                            />
                          ) : (
                            item.revision || '-'
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{item.partNumber}</TableCell>
                        <TableCell>
                          {editingPR ? (
                            <Textarea
                              value={item.description}
                              onChange={(e) => updateItem(index, 'description', e.target.value)}
                              className="min-h-[60px]"
                            />
                          ) : (
                            item.description
                          )}
                        </TableCell>
                        <TableCell>
                          {editingPR ? (
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 0)}
                              className="w-20"
                            />
                          ) : (
                            item.quantity
                          )}
                        </TableCell>
                        <TableCell>
                          {editingPR ? (
                            <Input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-24"
                            />
                          ) : (
                            `SGD ${item.unitPrice?.toLocaleString()}`
                          )}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const items = (editingPR || selectedPR)!.items;
                            const { bundleTotals, firstOccurrenceIndex } = calculateBundleTotals(items);
                            let bundleKey: string;

                            if (item.isAccessory) {
                              bundleKey = `${item.mainItemPartNumber}|${item.partNumber}|${item.description}`;
                            } else {
                              bundleKey = `${item.partNumber}|${item.description}`;
                            }

                            const isFirstOccurrence = firstOccurrenceIndex.get(bundleKey) === index;
                            return isFirstOccurrence ? bundleTotals.get(bundleKey) || 0 : '';
                          })()}
                        </TableCell>
                        <TableCell>
                          {editingPR ? (
                            <Input
                              value={item.remarks || ''}
                              onChange={(e) => updateItem(index, 'remarks', e.target.value)}
                              className="w-40"
                            />
                          ) : (
                            item.remarks || '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => {
                  setShowPRDialog(false);
                  setEditingPR(null);
                }}>
                  Close
                </Button>
                {editingPR && (
                  <Button onClick={savePR}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </Button>
                )}
                <Button 
                  variant="outline"
                  onClick={() => downloadPR(editingPR || selectedPR!)}
                  disabled={downloadingPR === (editingPR || selectedPR!)?.id}
                >
                  {downloadingPR === (editingPR || selectedPR!)?.id ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Downloading Excel...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Download Excel
                    </>
                  )}
                </Button>
                <Button 
                  onClick={() => downloadPRPDF(editingPR || selectedPR!)}
                  disabled={downloadingPRPDF === (editingPR || selectedPR!)?.id}
                >
                  {downloadingPRPDF === (editingPR || selectedPR!)?.id ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating PDF...
                    </>
                  ) : (
                    <>
                      <FileDown className="w-4 h-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
