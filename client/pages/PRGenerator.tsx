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
  Save
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import * as XLSX from 'xlsx';
import { ThemeToggle } from '@/components/ThemeToggle';

interface BOMItem {
  partNumber: string;
  description: string;
  quantity: number;
  supplier: string;
  symbol?: string;
  category?: string;
  drawingNumber?: string;
  requestedDate?: string;
  remarks?: string;
  unitPrice?: number;
  totalPrice?: number;
  rowIndex: number;
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
    // Check file type - only Excel and CSV allowed per acceptance criteria
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/vnd.ms-excel.sheet.binary.macroenabled.12', // .xlsb
      'text/csv' // .csv
    ];

    const fileName = file.name.toLowerCase();
    const allowedExtensions = ['.xlsx', '.xls', '.xlsb', '.csv'];
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!allowedTypes.includes(file.type) && !hasValidExtension) {
      setUploadError("Invalid file format. Please upload an Excel (.xlsx, .xls, .xlsb) or CSV file.");
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

  const processBOMFile = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setUploadError("");
    const startTime = Date.now();

          try {
        const data = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        
        console.log('Available sheets:', workbook.SheetNames);
        
        // Function to find header row in a sheet's data
        const findHeaderRowInSheet = (sheetData: any[][]): { headerRow: number, headers: string[] } | null => {
          // Check up to the first 10 rows for headers
          for (let rowIdx = 0; rowIdx < Math.min(10, sheetData.length); rowIdx++) {
            const row = sheetData[rowIdx];
            if (!row || row.length === 0) continue;
            
            const rowHeaders = row.map(cell => cell?.toString() || '');
            const hasMaker = rowHeaders.some(h => h.toLowerCase().includes('maker') || h.toLowerCase().includes('supplier'));
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
        
        // Try to find a sheet with BOM format (has 'Maker' and 'Model / Part No.' columns)
        let selectedSheet = workbook.SheetNames[0];
        let worksheet = workbook.Sheets[selectedSheet];
        let jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        let headerInfo = findHeaderRowInSheet(jsonData);
        
        // If first sheet doesn't have BOM format, try other sheets
        if (!headerInfo) {
          console.log(`Sheet "${selectedSheet}" doesn't have BOM format, trying other sheets...`);
          
          for (const sheetName of workbook.SheetNames.slice(1)) {
            const testWorksheet = workbook.Sheets[sheetName];
            const testData = XLSX.utils.sheet_to_json(testWorksheet, { header: 1 }) as any[][];
            const testHeaderInfo = findHeaderRowInSheet(testData);
            
            if (testHeaderInfo) {
              console.log(`Found BOM format in sheet "${sheetName}"`);
              selectedSheet = sheetName;
              worksheet = testWorksheet;
              jsonData = testData;
              headerInfo = testHeaderInfo;
              break;
            }
          }
        }
        
        if (!headerInfo) {
          throw new Error(`No BOM format found in any sheet. Looking for headers containing 'Maker' and 'Model/Part No.' columns. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
        
        const { headerRow, headers: sheetHeaders } = headerInfo;
        
        console.log(`Using sheet: "${selectedSheet}"`);
        console.log('Sheet headers:', sheetHeaders);

      if (jsonData.length < headerRow + 2) {
        throw new Error("File must contain at least a header row and one data row.");
      }

      const headers = sheetHeaders;
      const dataRows = jsonData.slice(headerRow + 1) as any[][];
        
        console.log('Combined headers:', headers);
        console.log('Total data rows to process:', dataRows.length);
        console.log('First 10 data rows:', dataRows.slice(0, 10));
        
        // Debug: Check for empty rows
        const nonEmptyRows = dataRows.filter(row => row && row.length > 0 && !row.every(cell => !cell || cell.toString().trim() === ''));
        console.log('Non-empty data rows:', nonEmptyRows.length);
        console.log('First 10 non-empty rows:', nonEmptyRows.slice(0, 10));
        
        // Debug: Check if "Maker" appears in the headers
        const makerInHeaders = headers.some(h => h && h.toString().toLowerCase().includes('maker'));
        console.log('Is "Maker" in headers?', makerInHeaders);
        console.log('All headers:', headers);

      // Find column indices with flexible matching
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
      const makerCol = findColumnIndex(['maker', 'supplier', 'vendor', 'manufacturer']);
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
        throw new Error(`Required columns not found. Need 'Maker' and 'Model / Part No.' columns. Found: ${headers.join(', ')}`);
      }

      // Process data with multi-row support
      const itemsGrouped: { [key: string]: number } = {};
      const supplierItems: { [key: string]: BOMItem[] } = {};
      const categoryBreakdown: { [key: string]: { [category: string]: number } } = {};
      let totalItems = 0;
      let validItemsCount = 0;
      let skippedRowsCount = 0;

      // Process rows in pairs to handle multi-row items
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        
        // Skip empty rows
        if (!row || row.length === 0 || row.every(cell => !cell || cell.toString().trim() === '')) {
          skippedRowsCount++;
          continue;
        }

        const qty = qtyCol !== -1 ? parseFloat(row[qtyCol]) || 1 : 1;
        const symbol = symbolCol !== -1 ? row[symbolCol]?.toString().trim() : '';
        const description = descriptionCol !== -1 ? row[descriptionCol]?.toString().trim() : '';
        const maker = makerCol !== -1 ? row[makerCol]?.toString().trim() : '';
        
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
        const partNumber = partNumberCol !== -1 ? row[partNumberCol]?.toString().trim() : '';
        const remarks = remarksCol !== -1 ? row[remarksCol]?.toString().trim() : '';

        console.log(`Row ${i + headerRow + 2}:`, { qty, symbol, description, maker, partNumber });

        // Check if this is a main item (has symbol and main description)
        const isMainItem = symbol && description && !description.toLowerCase().startsWith('c/w');
        
        // Check if this is a sub-component (no symbol, description starts with 'c/w')
        const isSubComponent = !symbol && description && description.toLowerCase().startsWith('c/w');

        if (isMainItem && maker && partNumber) {
          // Main item with both maker and part number
          const item: BOMItem = {
            partNumber,
            supplier: maker,
            description,
            quantity: qty,
            symbol,
            category: inferCategory(description),
            remarks,
            unitPrice: 0, // Default to 0, user will enter manually
            rowIndex: i + headerRow + 2
          };
          item.totalPrice = item.unitPrice! * item.quantity;
          
          addItemToGroups(item);
          validItemsCount++;
        } else if (isSubComponent && maker && partNumber) {
          // Sub-component with its own maker and part number
          const item: BOMItem = {
            partNumber,
            supplier: maker,
            description,
            quantity: qty,
            symbol: '',
            category: inferCategory(description),
            remarks,
            unitPrice: 0, // Default to 0, user will enter manually
            rowIndex: i + headerRow + 2
          };
          item.totalPrice = item.unitPrice! * item.quantity;
          
          addItemToGroups(item);
          validItemsCount++;
        } else if (maker && partNumber) {
          // Standalone item with both maker and part number
          const item: BOMItem = {
            partNumber,
            supplier: maker,
            description: description || 'No description',
            quantity: qty,
            symbol,
            category: inferCategory(description),
            remarks,
            unitPrice: 0, // Default to 0, user will enter manually
            rowIndex: i + headerRow + 2
          };
          item.totalPrice = item.unitPrice! * item.quantity;
          
          addItemToGroups(item);
          validItemsCount++;
        } else if (maker && !partNumber && description) {
          // Skip items with maker but no part number - they need manual review
          skippedRowsCount++;
          console.log(`Skipping row ${i + headerRow + 2}: has maker (${maker}) and description but no part number - needs manual review`);
        } else {
          skippedRowsCount++;
          console.log(`Skipping row ${i + headerRow + 2}: missing maker (found: ${maker || 'none'}) or insufficient information`);
        }
      }

      function addItemToGroups(item: BOMItem) {
        if (!itemsGrouped[item.supplier]) {
          itemsGrouped[item.supplier] = 0;
          supplierItems[item.supplier] = [];
          categoryBreakdown[item.supplier] = {};
        }
        
        itemsGrouped[item.supplier]++;
        supplierItems[item.supplier].push(item);
        
        const category = item.category || 'Uncategorized';
        if (!categoryBreakdown[item.supplier][category]) {
          categoryBreakdown[item.supplier][category] = 0;
        }
        categoryBreakdown[item.supplier][category]++;
        
        totalItems++;
      }

      function inferCategory(description: string): string {
        if (!description) return 'General';
        
        const desc = description.toLowerCase();
        if (desc.includes('electrical') || desc.includes('acb') || desc.includes('mccb') || desc.includes('breaker') || desc.includes('led') || desc.includes('relay')) {
          return 'Electrical';
        } else if (desc.includes('control') || desc.includes('unit') || desc.includes('trip') || desc.includes('pushbutton')) {
          return 'Control';
        } else if (desc.includes('mechanical') || desc.includes('mount') || desc.includes('bracket') || desc.includes('spring')) {
          return 'Mechanical';
        } else if (desc.includes('cable') || desc.includes('wire') || desc.includes('conductor')) {
          return 'Wiring';
        } else {
          return 'General';
        }
      }

      console.log('Processing summary:', {
        totalDataRows: dataRows.length,
        validItemsCount,
        skippedRowsCount,
        totalItems
      });

      if (totalItems === 0) {
        throw new Error(`No valid items found in the BOM. 
        Processed ${dataRows.length} data rows, found ${validItemsCount} valid items, skipped ${skippedRowsCount} rows.
        Make sure your BOM has data rows with both 'Model / Part No.' and 'Maker' columns filled.
        Check the browser console for detailed debugging information.`);
      }

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

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
          processingTime: `${processingTime} seconds`
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
        categoryBreakdown,
        processingTime: `${processingTime} seconds`,
        status: "success",
        fileName: selectedFile.name,
        fileSize: (selectedFile.size / 1024).toFixed(1) + ' KB',
        columnsFound: {
          partNumber: partNumberCol !== -1 ? `✓ ${headers[partNumberCol]}` : 'Not found',
          supplier: makerCol !== -1 ? `✓ ${headers[makerCol]}` : 'Not found',
          description: descriptionCol !== -1 ? `✓ ${headers[descriptionCol]}` : 'Not found',
          quantity: qtyCol !== -1 ? `✓ ${headers[qtyCol]}` : 'Not found',
          symbol: symbolCol !== -1 ? `✓ ${headers[symbolCol]}` : 'Not found',
          remarks: remarksCol !== -1 ? `✓ ${headers[remarksCol]}` : 'Not found'
        },
        // Also store the raw column indices for debugging
        columnIndices: {
          partNumber: partNumberCol,
          supplier: makerCol,
          description: descriptionCol,
          quantity: qtyCol,
          symbol: symbolCol,
          remarks: remarksCol
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

  const generatePurchaseRequisitions = async () => {
    if (!processedData) return;

    try {
      const prs: PurchaseRequisition[] = Object.entries(processedData.supplierItems).map(([supplier, items], index) => {
        const itemsArray = items as BOMItem[];
        const totalValue = itemsArray.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
        
        return {
          id: Date.now().toString() + index,
          supplier,
          items: itemsArray,
          totalItems: itemsArray.length,
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

    try {
      // Try to save to API first
    try {
      const response = await fetch(`/api/purchase-requisitions/${editingPR.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          supplier: editingPR.supplier,
          totalItems: editingPR.totalItems,
          totalValue: editingPR.totalValue,
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

  const downloadPR = (pr: PurchaseRequisition) => {
    console.log('Downloading PR:', pr);
    setDownloadingPR(pr.id);
    
    try {
      // Create PR data for Excel export
      const prData = [
      // Header information
      ['PURCHASE REQUISITION'],
      [],
      ['PR Number:', pr.prNumber],
      ['Supplier:', pr.supplier],
      ['Date Created:', pr.createdAt],
      ['Status:', pr.status],
      ['Total Items:', pr.totalItems],
      ['Total Value:', `₱${pr.totalValue.toLocaleString()}`],
      [],
      
      // Items table header
      ['Item #', 'Symbol', 'Part Number', 'Description', 'Quantity', 'Category', 'Unit Price', 'Total Price', 'Remarks'],
      
      // Items data
      ...pr.items.map((item, index) => [
        index + 1,
        item.symbol || '',
        item.partNumber,
        item.description,
        item.quantity,
        item.category || '',
        `₱${(item.unitPrice || 0).toLocaleString()}`,
        `₱${(item.totalPrice || 0).toLocaleString()}`,
        item.remarks || ''
      ]),
      
      // Summary
      [],
      ['', '', '', '', '', '', 'TOTAL:', `₱${pr.totalValue.toLocaleString()}`, '']
    ];

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(prData);

    // Set column widths
    const colWidths = [
      { wch: 8 },  // Item #
      { wch: 15 }, // Symbol
      { wch: 20 }, // Part Number
      { wch: 40 }, // Description
      { wch: 10 }, // Quantity
      { wch: 15 }, // Category
      { wch: 15 }, // Unit Price
      { wch: 15 }, // Total Price
      { wch: 20 }  // Remarks
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
                      accept=".xlsx,.xls,.xlsb,.csv"
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
                                                       <p className="text-xs text-muted-foreground mt-2">Supports Excel (.xlsx, .xls, .xlsb) and CSV files</p>
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

                  <div className="mt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <AlertCircle className="w-4 h-4" />
                        <span>Make sure your BOM includes columns for: Qty, Symbol, Description, Maker, Model/Part No., and Remarks</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={downloadTemplate}>
                        <Download className="w-4 h-4 mr-2" />
                        Download Template
                      </Button>
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
                        <div className="text-2xl font-bold text-foreground">{processedData.processingTime}</div>
                        <div className="text-sm text-muted-foreground">Processing Time</div>
                    </div>
                  </div>

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
                      ✅ All required columns detected successfully. Your "Maker or supplier" column is being used as the supplier source.
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
                          {processedData.categoryBreakdown[supplier] && (
                            <div className="text-xs text-muted-foreground flex flex-wrap gap-1">
                              {Object.entries(processedData.categoryBreakdown[supplier]).map(([cat, catCount]) => (
                                <Badge key={cat} variant="outline" className="text-xs">
                                  {cat}: {catCount as number}
                                </Badge>
                              ))}
                            </div>
                          )}
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
                              onClick={() => downloadPR(pr)}
                              disabled={downloadingPR === pr.id}
                            >
                              {downloadingPR === pr.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="text-sm text-gray-600">
                          Total Value: ₱{pr.totalValue.toLocaleString()}
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
                        ₱{purchaseRequisitions.reduce((sum, pr) => sum + pr.totalValue, 0).toLocaleString()}
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
                            {pr.totalItems} items • ₱{pr.totalValue.toLocaleString()}
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
                          // Download all PRs as a single file or zip
                          purchaseRequisitions.forEach(pr => downloadPR(pr));
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download All PRs
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

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center text-muted-foreground py-4">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No recent activity</p>
                  <p className="text-xs">Upload your first BOM to get started</p>
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
                  <p className="text-sm text-foreground mt-1">{(editingPR || selectedPR)!.prNumber}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Supplier</label>
                  <p className="text-sm text-foreground mt-1">{(editingPR || selectedPR)!.supplier}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Total Items</label>
                  <p className="text-sm text-gray-900 mt-1">{(editingPR || selectedPR)!.totalItems}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Total Value</label>
                  <p className="text-sm text-gray-900 mt-1">₱{(editingPR || selectedPR)!.totalValue.toLocaleString()}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">Items</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Part Number</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Total Price</TableHead>
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
                              value={item.category || ''}
                              onChange={(e) => updateItem(index, 'category', e.target.value)}
                              className="w-32"
                            />
                          ) : (
                            item.category || '-'
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
                            `₱${item.unitPrice?.toLocaleString()}`
                          )}
                        </TableCell>
                        <TableCell>₱{item.totalPrice?.toLocaleString()}</TableCell>
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
                  onClick={() => downloadPR(editingPR || selectedPR!)}
                  disabled={downloadingPR === (editingPR || selectedPR!)?.id}
                >
                  {downloadingPR === (editingPR || selectedPR!)?.id ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Download PR
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
