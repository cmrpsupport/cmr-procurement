import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft,
  Upload, 
  FileText,
  Zap,
  Loader2, 
  Download,
  Eye,
  X
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { ThemeToggle } from '@/components/ThemeToggle';
import * as XLSX from 'xlsx';

export default function ReportBuilder() {
  // Single file processing states
  const [erpFile, setErpFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<any>(null);
  const [showResults, setShowResults] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string>("");
  
  // Toast notifications
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  
  // Template management
  const [savedTemplate, setSavedTemplate] = useState<{
    name: string;
    headers: string[];
    savedDate: string;
  } | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  
  const erpFileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  // Load saved template from localStorage on component mount
  useEffect(() => {
    const savedTemplateData = localStorage.getItem('savedTemplate');
    if (savedTemplateData) {
      try {
        const template = JSON.parse(savedTemplateData);
        setSavedTemplate(template);
        console.log('Loaded saved template from localStorage:', template);
      } catch (error) {
        console.error('Error loading saved template:', error);
        localStorage.removeItem('savedTemplate');
      }
    }
  }, []);

  const processCurrentFile = async () => {
    if (!erpFile) return;
    
    setIsProcessing(true);
    setAnalysisMessage("Processing ERP file...");

    try {
      const content = await readFileContent(erpFile);
      const parsedData = parseFileContent(content, erpFile.name);
      
      setProcessedData(parsedData);
      setShowResults(true);
      setAnalysisMessage("File processed successfully!");
      
      showToastMessage("✅ ERP file processed successfully! Enhanced report ready.", "success");
    } catch (error) {
      console.error('Error processing file:', error);
      setAnalysisMessage("Error processing file. Please try again.");
      showToastMessage("❌ Error processing file. Please check the file format.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // File upload handlers
  const handleErpFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setErpFile(file);
      setShowResults(false); // Reset results when new file is uploaded
    }
  };

  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        // Actually read the template file and extract real headers
        const content = await readFileContent(file);
        const lines = content.split('\n');
        const headers = lines[0]?.split(',').map(header => header.trim().replace(/^"|"$/g, '')) || [];
        
        console.log('Template headers extracted:', headers);
        
        // Validate that we have headers
        if (headers.length === 0) {
          showToastMessage("❌ Could not extract headers from template file", "error");
          return;
        }
        
        const templateData = {
          name: file.name,
          headers: headers,
          savedDate: new Date().toLocaleDateString()
        };
        
        setSavedTemplate(templateData);
        localStorage.setItem('savedTemplate', JSON.stringify(templateData));
        
        showToastMessage(`✅ Template uploaded! Found ${headers.length} columns`, "success");
      } catch (error) {
        console.error('Error reading template file:', error);
        showToastMessage("❌ Error reading template file. Please check the format.", "error");
      }
    }
  };

  const handleFileDrop = (event: React.DragEvent, fileType: 'erp' | 'template') => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (fileType === 'erp') {
        setErpFile(file);
        setShowResults(false);
      } else if (fileType === 'template') {
        handleTemplateUpload({ target: { files: [file] } } as any);
      }
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const showToastMessage = (message: string, type: "success" | "error" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 5000);
  };

  const handleDownloadEnhancedReport = () => {
    if (!processedData) return;
    
    try {
      // Fixed preferred format headers
      const headers = [
        "S/N",
        "Work Order Number", 
        "Client",
        "Vendor",
        "P.O Number",
        "PO Issued Date",
        "P.R Number",
        "PR Issued Date",
        "PR Prepared by",
        "Item No",
        "Item Description",
        "Order Qty",
        "Unit",
        "Unit Price",
        "Total Price",
        "DO Number",
        "Qty Received",
        "Qty Outstanding",
        "Vendor Acknowledgement",
        "Required Delivery Date",
        "Vendor Est Delivery Date (ETA)",
        "Actual Receiving Date",
        "Status update/Comments"
      ];

      // Create a mapping function that intelligently maps ERP data to template columns
      const mapDataToTemplate = (item: any, index: number) => {
        const mapped = item.mappedData;
        const row: string[] = [];
        
        
        // For each header in the template, try to find the corresponding data
        headers.forEach((header: string, headerIndex: number) => {
          const headerLower = header.toLowerCase();
          let value = "";
          
          // Debug for first row only
          if (index === 0 && (header === 'Qty Received' || header === 'Qty Outstanding')) {
            console.log(`🔍 PROCESSING "${header}" (headerLower: "${headerLower}") for row 1:`);
            console.log(`  mapped.qtyReceived = "${mapped.qtyReceived}"`);
            console.log(`  mapped.qtyOutstanding = "${mapped.qtyOutstanding}"`);
            console.log(`  Will match qty received?`, headerLower.includes('qty received'));
            console.log(`  Will match qty outstanding?`, headerLower.includes('qty outstanding'));
          }
          
          // Smart mapping based on header names
          if (headerLower.includes('s/n') || headerLower.includes('serial')) {
            value = ""; // Keep blank as requested
          } else if (headerLower.includes('work order')) {
            value = mapped.workOrderNumber || `WO-${String(index + 1).padStart(3, '0')}`;
          } else if (headerLower.includes('client') && !headerLower.includes('vendor')) {
            value = ""; // Keep blank as requested
          } else if (headerLower === 'vendor') {
            value = mapped.vendor || "Vendor from ERP";
          } else if (headerLower.includes('p.o number') || header === 'P.O Number') {
            value = mapped.poNumber || processedData.poNumber;
          } else if (headerLower === 'po issued date') {
            value = mapped.orderDate || new Date().toLocaleDateString();
          } else if (headerLower === 'p.r number') {
            value = mapped.prNumber || `PR-${String(index + 1).padStart(3, '0')}`;
          } else if (headerLower === 'pr issued date' || headerLower === 'pr prepared by') {
            value = ""; // Keep blank as requested
          } else if (headerLower.includes('item no') || headerLower.includes('item number')) {
            value = mapped.itemNo;
          } else if (headerLower.includes('description') || headerLower.includes('item description')) {
            value = mapped.description;
          } else if (headerLower.includes('order qty') || headerLower.includes('order quantity') || (headerLower.includes('qty') && !headerLower.includes('received') && !headerLower.includes('outstanding')) || (headerLower.includes('quantity') && !headerLower.includes('received') && !headerLower.includes('outstanding'))) {
            value = mapped.orderQty;
          } else if (headerLower.includes('unit') && !headerLower.includes('price')) {
            value = mapped.unit;
          } else if (headerLower.includes('unit price') || headerLower.includes('unit cost')) {
            value = mapped.unitPrice;
          } else if (headerLower.includes('total price') || headerLower.includes('extended cost') || headerLower.includes('total cost')) {
            value = mapped.totalPrice;
          } else if (headerLower.includes('do number') || headerLower.includes('delivery order')) {
            value = mapped.doNumber || "";
          } else if (headerLower.includes('qty received') || headerLower.includes('quantity received')) {
            console.log(`🚨 ENTERING QTY RECEIVED CONDITION for row ${index}`);
            value = mapped.qtyReceived || "";
            console.log(`🚨 ASSIGNED VALUE: "${value}" from mapped.qtyReceived: "${mapped.qtyReceived}"`);
          } else if (headerLower.includes('qty outstanding') || headerLower.includes('quantity outstanding')) {
            value = mapped.qtyOutstanding || "";
            if (index === 0) console.log(`✅ MAPPING - Qty Outstanding: "${mapped.qtyOutstanding}" → "${value}"`);
          } else if (headerLower === 'vendor acknowledgement' || headerLower === 'required delivery date' || headerLower.includes('vendor est delivery') || headerLower.includes('actual receiving') || headerLower.includes('status update') || headerLower.includes('comment')) {
            value = ""; // Keep blank as requested
          }
          
          row.push(value || "");
          
          if (index === 0 && (header === 'Qty Received' || header === 'Qty Outstanding')) {
            console.log(`🎯 FINAL PUSH for ${header}: value="${value}", pushed="${value || ""}", row length now: ${row.length}`);
          }
        });
        
        return row;
      };

      // Transform the processed data using the smart mapping
      const enhancedData = processedData.processedData.map(mapDataToTemplate);
      
      console.log('FINAL CSV GENERATION DEBUG:');
      console.log('Template headers:', headers);
      console.log('Sample enhanced row:', enhancedData[0]);
      console.log('Expected: Qty Received should be 0, Qty Outstanding should be 2');

      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...enhancedData.map((row: string[]) => 
          row.map((cell: string) => `"${cell || ''}"`).join(',')
        )
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      // Remove original file extension and add .csv
      const originalFileName = processedData.fileName;
      const fileNameWithoutExtension = originalFileName.replace(/\.[^/.]+$/, '');
      link.setAttribute('download', `enhanced-${fileNameWithoutExtension}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      showToastMessage("✅ Enhanced report downloaded successfully!", "success");
    } catch (error) {
      console.error('Error downloading report:', error);
      showToastMessage("❌ Error downloading report", "error");
    }
  };

  // Function to read file content - handle CSV and Excel files
  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          
          // Check if this is an Excel file (binary)
          if (file.name.toLowerCase().endsWith('.xlsx') || 
              file.name.toLowerCase().endsWith('.xls')) {
            
            console.log('Detected Excel file, parsing with XLSX library...');
            
            // Read as binary string for XLSX
            const binaryString = e.target?.result as string;
            const workbook = XLSX.read(binaryString, { type: 'binary' });
            
            // Get the first sheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to CSV
            const csvContent = XLSX.utils.sheet_to_csv(worksheet);
            resolve(csvContent);
          } else {
            // Handle as regular text file (CSV)
            resolve(content);
          }
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      
      // Read as binary string for Excel files, text for CSV
      if (file.name.toLowerCase().endsWith('.xlsx') || 
          file.name.toLowerCase().endsWith('.xls')) {
        reader.readAsBinaryString(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  // Function to parse file content and extract real data
  const parseFileContent = (content: string, fileName: string) => {
    console.log("=== PARSING FILE CONTENT ===");
    console.log("Raw content length:", content.length);
    console.log("Raw content preview:", content.substring(0, 500));
    
    const lines = content.split('\n');
    console.log("Total lines:", lines.length);
    console.log("First 3 lines:", lines.slice(0, 3));
    
    const headers = lines[0]?.split(',') || [];
    console.log("Headers found:", headers);
    
    // Extract data rows (skip header)
    const dataRows = lines.slice(1).filter(line => line.trim() !== '');
    console.log("Data rows found:", dataRows.length);
    console.log("First 3 data rows:", dataRows.slice(0, 3));
    
    // Find column indices based on ERP headers
    const poNumberIndex = headers.findIndex(h => h.toLowerCase().includes('purchase order number'));
    const orderDateIndex = headers.findIndex(h => h.toLowerCase().includes('order date'));
    const nameIndex = headers.findIndex(h => h.toLowerCase().includes('name'));
    const descriptionIndex = headers.findIndex(h => h.toLowerCase().includes('description'));
    const itemNumberIndex = headers.findIndex(h => h.toLowerCase().includes('item number'));
    const itemDescriptionIndex = headers.findIndex(h => h.toLowerCase().includes('item description'));
    const quantityOrderedIndex = headers.findIndex(h => h.toLowerCase().includes('quantity ordered'));
    const unitOfMeasureIndex = headers.findIndex(h => h.toLowerCase().includes('unit of measure'));
    const currencyIndex = headers.findIndex(h => h.toLowerCase().includes('currency'));
    const unitCostIndex = headers.findIndex(h => h.toLowerCase().includes('unit cost'));
    const extendedCostIndex = headers.findIndex(h => h.toLowerCase().includes('extended cost'));
    const expectedArrivalIndex = headers.findIndex(h => h.toLowerCase().includes('expected arrival date'));
    const doNumberIndex = headers.findIndex(h => h.toLowerCase().includes('do number') || h.toLowerCase().includes('delivery order'));
    const qtyReceivedIndex = headers.findIndex(h => {
      const cleanHeader = h.toLowerCase().replace('*', '').trim();
      return cleanHeader === 'quantity received' || cleanHeader.includes('quantity received') || cleanHeader.includes('qty received');
    });
    const qtyOutstandingIndex = headers.findIndex(h => {
      const cleanHeader = h.toLowerCase().replace('*', '').trim();
      return cleanHeader === 'quantity outstanding' || cleanHeader.includes('quantity outstanding') || cleanHeader.includes('qty outstanding');
    });
    
    console.log('ERP Headers found:', headers);
    console.log('Column indices found:', {
      poNumberIndex,
      orderDateIndex,
      nameIndex,
      descriptionIndex,
      itemNumberIndex,
      itemDescriptionIndex,
      quantityOrderedIndex,
      unitOfMeasureIndex,
      currencyIndex,
      unitCostIndex,
      extendedCostIndex,
      expectedArrivalIndex,
      doNumberIndex,
      qtyReceivedIndex,
      qtyOutstandingIndex
    });
    

    // Process each data row to extract mapped information
    const processedData = dataRows.map((row, index) => {
      console.log(`Processing row ${index + 1}:`, row);
      
      // Use tab-separated parsing first, then fallback to comma-separated
      let cells: string[] = [];
      
      // Try tab-separated first (common in Excel exports)
      if (row.includes('\t')) {
        cells = row.split('\t').map(cell => cell.trim().replace(/^"|"$/g, ''));
      } else {
        // Fallback to comma-separated with better handling
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < row.length; i++) {
          const char = row[i];
          
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        
        // Add the last field
        result.push(current.trim());
        cells = result.map(cell => cell.replace(/^"|"$/g, ''));
      }
      
      console.log(`Row ${index + 1} cells:`, cells);
      console.log(`Row ${index + 1} cell count:`, cells.length);
      
      // Check if this row has the expected number of columns
      if (cells.length !== headers.length) {
        console.warn(`⚠️ Row ${index + 1} has ${cells.length} cells but headers has ${headers.length} columns!`);
      }
      
      // Extract data using the correct ERP column indices found in headers
      const poNumber = poNumberIndex >= 0 ? cells[poNumberIndex] : '';
      const orderDate = orderDateIndex >= 0 ? cells[orderDateIndex] : '';
      const name = nameIndex >= 0 ? cells[nameIndex] : '';
      const description = descriptionIndex >= 0 ? cells[descriptionIndex] : '';
      const itemNumber = itemNumberIndex >= 0 ? cells[itemNumberIndex] : ''; // Use actual Item Number column
      const itemDescription = itemDescriptionIndex >= 0 ? cells[itemDescriptionIndex] : ''; // Use actual Item Description column
      
      // Extract Work Order Number from Description field (e.g., "PR52996/REV1,JOB_25006YB")
      let workOrderNumber = '';
      if (description) {
        // Find Work Order Number (last alphanumeric characters after the "_")
        const woMatch = description.match(/_([A-Za-z0-9]+)/);
        if (woMatch) {
          workOrderNumber = woMatch[1].replace('JOB_', ''); // Remove JOB_ prefix if present
        }
      }
      
      // Fallback: generate sequential work order number if not found
      if (!workOrderNumber) {
        workOrderNumber = `WO-${String(index + 1).padStart(3, '0')}`;
      }
      
      const quantityOrdered = quantityOrderedIndex >= 0 ? cells[quantityOrderedIndex] : '1'; // Use actual Quantity Ordered column
      const unitOfMeasure = unitOfMeasureIndex >= 0 ? cells[unitOfMeasureIndex] : 'PCS'; // Use actual Unit of Measure column
      const currency = currencyIndex >= 0 ? cells[currencyIndex] : 'USD'; // Use actual Currency column
      const unitCost = unitCostIndex >= 0 ? cells[unitCostIndex] : '0.00'; // Use actual Unit Cost column
      let extendedCost = extendedCostIndex >= 0 ? cells[extendedCostIndex] : '0.00'; // Use actual Extended Cost column
      
      // If extended cost is 0 or empty, calculate it from unit cost * quantity
      if (!extendedCost || extendedCost === '0' || extendedCost === '0.00') {
        const qty = parseFloat(quantityOrdered) || 0;
        const unitPrice = parseFloat(unitCost) || 0;
        extendedCost = (qty * unitPrice).toFixed(2);
      }
      const expectedArrival = expectedArrivalIndex >= 0 ? cells[expectedArrivalIndex] : ''; // Use actual Expected Arrival Date column
      const doNumber = doNumberIndex >= 0 ? cells[doNumberIndex] : ''; // Use actual DO Number column
      const qtyReceived = qtyReceivedIndex >= 0 ? cells[qtyReceivedIndex] : ''; // Use actual Qty Received column
      const qtyOutstanding = qtyOutstandingIndex >= 0 ? cells[qtyOutstandingIndex] : ''; // Use actual Qty Outstanding column
      
      if (index === 0) { // Only log first row to debug
        console.log(`DEBUG ROW 1 EXTRACTION:`);
        console.log(`  qtyReceivedIndex: ${qtyReceivedIndex}, cells[${qtyReceivedIndex}]: "${qtyReceived}"`);
        console.log(`  qtyOutstandingIndex: ${qtyOutstandingIndex}, cells[${qtyOutstandingIndex}]: "${qtyOutstanding}"`);
      }
      
      
      // Extract and format Order Date (YYYYMMDD to DD/MM/YYYY)
      let formattedOrderDate = '';
      if (orderDate && orderDate.length === 8 && /^\d{8}$/.test(orderDate)) {
        // Convert YYYYMMDD to DD/MM/YYYY
        const year = orderDate.substring(0, 4);
        const month = orderDate.substring(4, 6);
        const day = orderDate.substring(6, 8);
        formattedOrderDate = `${day}/${month}/${year}`;
      } else {
        formattedOrderDate = orderDate || new Date().toLocaleDateString();
      }
      
      // Parse description to extract PR number
      let prNumber = '';
      if (description) {
        // Find PR number (characters before the first "/")
        const prMatch = description.match(/^([^\/]+)/);
        if (prMatch) {
          prNumber = prMatch[1];
        }
        
        console.log(`Parsing description: "${description}"`);
        console.log(`  - PR Number extracted: ${prNumber}`);
      }
      
      // Generate fallback values if not found
      if (!prNumber) {
        prNumber = `PR-${String(index + 1).padStart(3, '0')}`;
      }
      
      return {
        originalRow: cells,
        mappedData: {
          poNumber,
          orderDate: formattedOrderDate,
          vendor: name,
          description: itemDescription, // Direct transfer - no modifications
          prNumber, // ERP Column 4 → Enhanced Column 7 (P.R Number)
          workOrderNumber: workOrderNumber, // ERP Column 4 → Enhanced Work Order Number (remove JOB_)
          itemNo: itemNumber, // ERP Column 5 → Enhanced Item No
          orderQty: quantityOrdered, // ERP Column 7 → Enhanced Column 12 (Order Qty)
          unit: unitOfMeasure, // ERP Column 8 → Enhanced Column 13 (Unit)
          unitPrice: unitCost, // ERP Column 10 → Enhanced Column 14 (Unit Price)
          totalPrice: extendedCost, // ERP Column 11 → Enhanced Column 15 (Total Price)
          doNumber, // DO Number from ERP
          qtyReceived, // Qty Received from ERP
          qtyOutstanding, // Qty Outstanding from ERP
          expectedArrival
        }
      };
    });

    // Get PO number from first row or filename
    let poNumber = '';
    if (processedData.length > 0 && processedData[0].mappedData.poNumber) {
      poNumber = processedData[0].mappedData.poNumber;
    } else {
      // Try to extract from filename
      const poMatch = fileName.match(/PO[-\s]?(\d+)/i);
      if (poMatch) {
        poNumber = poMatch[0];
      }
    }

    console.log('Processed data sample:', processedData.slice(0, 2));

    return {
      headers,
      dataRows,
      processedData,
      itemCount: dataRows.length,
      poNumber,
      fileName
    };
  };

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
              <div>
                <h1 className="text-2xl font-bold text-foreground">ERP Report Enhancer</h1>
                <p className="text-sm text-muted-foreground">Upload ERP reports and get them instantly formatted in your preferred template</p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Main Content */}
        <div className="max-w-4xl mx-auto">
          <Card className="p-6">
                               <div className="flex items-center justify-between mb-6">
                     <h2 className="text-xl font-semibold text-foreground">Single File Enhancement</h2>
                     <Badge variant="secondary">Simple & Fast</Badge>
        </div>

            {/* File Upload Section */}
            <div className="space-y-6">
              {/* ERP Report Upload */}
                        <div>
                       <h3 className="text-lg font-medium text-foreground mb-3">Upload ERP Report</h3>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                    erpFile
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-border hover:border-primary'
                  }`}
                  onDrop={(e) => handleFileDrop(e, 'erp')}
                  onDragOver={handleDragOver}
                >
                  {erpFile ? (
                    <div className="space-y-2">
                      <FileText className="w-8 h-8 text-green-600 mx-auto" />
                      <p className="font-medium text-green-900">{erpFile.name}</p>
                      <p className="text-sm text-green-700">{(erpFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setErpFile(null);
                          setShowResults(false);
                        }}
                      >
                        Remove File
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                                               <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                         <p className="text-muted-foreground">Drag and drop your ERP report here</p>
                         <p className="text-sm text-muted-foreground">or</p>
                      <Button
                        variant="outline"
                        onClick={() => erpFileInputRef.current?.click()}
                      >
                        Choose File
                      </Button>
                      <input
                        ref={erpFileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleErpFileUpload}
                        className="hidden"
                      />
                    </div>
                            )}
                          </div>
                        </div>


              {/* Process Button */}
              <div className="pt-4">
                <Button
                  onClick={processCurrentFile}
                  disabled={!erpFile || isProcessing}
                  className="w-full"
                  size="lg"
                >
                  {isProcessing ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4 mr-2" />
                      Enhance ERP Report
                            </>
                          )}
                        </Button>
                                       {analysisMessage && (
                         <p className="mt-2 text-sm text-muted-foreground">{analysisMessage}</p>
                       )}
                        </div>
                      </div>

            {/* Results Section */}
            {showResults && processedData && (
              <div className="mt-8 pt-6 border-t">
                                       <div className="flex items-center justify-between mb-4">
                         <h3 className="text-lg font-medium text-foreground">Enhanced Report Results</h3>
                  <div className="flex space-x-3">
                    <Button
                      onClick={handleDownloadEnhancedReport}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Enhanced Report
                          </Button>
                    <Button
                      onClick={() => {
                        setErpFile(null);
                        setProcessedData(null);
                        setShowResults(false);
                        setAnalysisMessage("");
                        if (erpFileInputRef.current) {
                          erpFileInputRef.current.value = "";
                        }
                      }}
                      variant="outline"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Clear Page
                          </Button>
                        </div>
                      </div>
                
                <div className="bg-card border rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                      <span className="font-medium text-foreground">File Name:</span> <span className="text-muted-foreground">{processedData.fileName}</span>
                              </div>
                    <div>
                      <span className="font-medium text-foreground">Items Processed:</span> <span className="text-muted-foreground">{processedData.itemCount}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">PO Number:</span> <span className="text-muted-foreground">{processedData.poNumber}</span>
                  </div>
                  </div>
                </div>

                {/* Preview Table */}
                <div className="max-h-96 overflow-y-auto border border-border rounded-lg bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-foreground">Item No</TableHead>
                        <TableHead className="text-foreground">Description</TableHead>
                        <TableHead className="text-foreground">Work Order</TableHead>
                        <TableHead className="text-foreground">Qty</TableHead>
                        <TableHead className="text-foreground">Unit</TableHead>
                        <TableHead className="text-foreground">Unit Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processedData.processedData.slice(0, 10).map((item: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="text-foreground">{item.mappedData.itemNo}</TableCell>
                          <TableCell className="max-w-xs truncate text-foreground">{item.mappedData.description}</TableCell>
                          <TableCell className="text-foreground">{item.mappedData.workOrderNumber}</TableCell>
                          <TableCell className="text-foreground">{item.mappedData.orderQty}</TableCell>
                          <TableCell className="text-foreground">{item.mappedData.unit}</TableCell>
                          <TableCell className="text-foreground">{item.mappedData.unitPrice}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                                         {processedData.processedData.length > 10 && (
                           <p className="text-sm text-muted-foreground mt-2">
                             Showing first 10 items. Download the full report to see all {processedData.processedData.length} items.
                           </p>
                         )}
              </div>
            )}
            </Card>
        </div>
      </div>

      {/* Template Modal */}
      {showTemplateModal && savedTemplate && (
        <Dialog open={showTemplateModal} onOpenChange={setShowTemplateModal}>
          <DialogContent className="max-w-4xl">
          <DialogHeader>
              <DialogTitle>Template Headers</DialogTitle>
            <DialogDescription>
                Preferred format template headers for enhanced reports
            </DialogDescription>
          </DialogHeader>
            <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                    <TableHead className="text-foreground">Column</TableHead>
                    <TableHead className="text-foreground">Header Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {savedTemplate.headers.map((header, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-sm text-foreground">{index + 1}</TableCell>
                      <TableCell className="text-foreground">{header}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Toast */}
      {showToast && (
        <div className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${
          toastType === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toastMessage}
            </div>
          )}
    </div>
  );
}
