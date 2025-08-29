import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Upload, 
  FileText, 
  Brain, 
  Loader2, 
  Download,
  Eye,
  X,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
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

interface Document {
  id: string;
  originalName: string;
  renamedName: string;
  type: "Delivery Order" | "Invoice" | "Other";
  date: string;
  status: "Processing" | "Processed" | "Error";
  supplier: string;
  poNumber: string;
  projectNumber: string;
  extractedData: {
    supplier: string;
    poNumber: string;
    projectNumber: string;
    date: string;
    totalAmount?: string;
    deliveryDate?: string;
    items?: string[];
    pageCount?: number;
  };
  fileSize: string;
  uploadTime: string;
  filePath?: string;
}

export default function DocumentAssistant() {
  // Single file processing states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedDocument, setProcessedDocument] = useState<Document | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string>("");
  
  // UI states
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    console.log("handleFileSelect called with file:", file);
    
    // Check file type - only JPG, PNG, PDF allowed for scanned DOs
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      console.log("Invalid file type:", file.type);
      setUploadError("Invalid file format. Please upload JPG, PNG, or PDF files only.");
      return;
    }

    // Check file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      console.log("File too large:", file.size);
      setUploadError("File must be less than 5MB");
      return;
    }

    console.log("File validated successfully");
    setSelectedFile(file);
    setShowResults(false); // Reset results when new file is selected
    setUploadError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    console.log("handleDrop called");
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    console.log("Dropped files:", files);
    if (files.length > 0) {
      handleFileSelect(files[0]); // Only process the first file
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
    console.log("handleFileInputChange called");
    const files = e.target.files;
    console.log("Selected files from input:", files);
    if (files && files.length > 0) {
      handleFileSelect(files[0]); // Only process the first file
    }
  };

  const processDocument = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setProcessingMessage("Processing document...");
    setUploadError("");

    try {
      console.log("Starting document processing for:", selectedFile.name);

      // Create FormData for file upload
      const formData = new FormData();
      formData.append("document", selectedFile);

      // Update processing message based on file type
      if (selectedFile.type.startsWith("image/")) {
        setProcessingMessage("Running OCR on document...");
      } else if (selectedFile.type === "application/pdf") {
        setProcessingMessage("Extracting text from PDF...");
      }

      // Call the API endpoint with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      const response = await fetch("/api/process-document", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
        } catch (parseError) {
          // If we can't parse the error response, use the status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log("API response:", result);

      // Convert API result to Document format
      const document: Document = {
        id: result.id,
        originalName: result.originalName,
        renamedName: result.renamedName,
        type: "Delivery Order",
        fileSize: `${(result.fileSize / 1024 / 1024).toFixed(1)} MB`,
        status: result.status,
        supplier: result.supplier,
        poNumber: result.poNumber,
        projectNumber: result.projectNumber,
        date: result.date,
        extractedData: result.extractedData,
        filePath: result.filePath,
        uploadTime: new Date().toLocaleString(),
      };

      // Add processing analysis info
      const enhancedDocument = {
        ...document,
        processingType: selectedFile.type.startsWith('image/') ? 'Real OCR Analysis' : 'PDF Analysis (Windows Compatible)',
        fileAnalysis: `File: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`,
        templateUsed: document.extractedData?.pageCount > 1 ? 'Multi-page Document' : 'Single Page Document',
        processingMethod: 'Real Document Processing (No Mock Data)'
      };
      
      setProcessedDocument(enhancedDocument);
      setShowResults(true);
      
      console.log("Successfully processed document:", enhancedDocument);

    } catch (error) {
      console.error("Document processing error:", error);
      
      let errorMessage = "Failed to process document";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = "Request timed out. Please try again with a smaller file or check your connection.";
        } else {
          errorMessage = error.message;
        }
      }
      
      setUploadError(errorMessage);
    } finally {
      setSelectedFile(null);
      setIsProcessing(false);
      setProcessingMessage("");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const openDocument = (doc: Document) => {
    console.log("Opening document:", doc);
    setSelectedDocument(doc);
    setShowDocumentDialog(true);
  };

  const generateCSVFromDocument = (doc: Document): string => {
    const headers = [
      'Field',
      'Extracted Value'
    ];
    
    const rows = [
      ['Supplier Name', doc.extractedData?.supplier || 'Not found'],
      ['PO Number', doc.extractedData?.poNumber || 'Not found'],
      ['Project Number', doc.extractedData?.projectNumber || 'Not found'],
      ['Date', doc.extractedData?.date || 'Not found'],
      ['Delivery Date', doc.extractedData?.deliveryDate || 'Not found'],
      ['Total Amount', doc.extractedData?.totalAmount || 'Not found'],
      ['Pages', doc.extractedData?.pageCount ? `${doc.extractedData.pageCount} pages` : '1 page'],
      ['Items', doc.extractedData?.items?.join('; ') || 'Not found'],
      ['Original File', doc.originalName],
      ['Processed File', doc.renamedName],
      ['File Size', doc.fileSize],
      ['Processing Date', doc.uploadTime]
    ];
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csvContent;
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
                <h1 className="text-2xl font-bold text-foreground">Document Assistant</h1>
                <p className="text-sm text-muted-foreground">Process delivery orders with AI-powered extraction</p>
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
                     <h2 className="text-xl font-semibold text-foreground">Process Delivery Order</h2>
                     <Badge variant="secondary">AI-Powered</Badge>
                   </div>

            {/* File Upload Section */}
            <div className="space-y-6">
                                   <div>
                       <h3 className="text-lg font-medium text-foreground mb-3">Upload Document</h3>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
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
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={handleFileInputChange}
                  />

                  {isProcessing ? (
                    <div className="space-y-4">
                      <Loader2 className="w-12 h-12 text-blue-500 mx-auto animate-spin" />
                      <div className="space-y-2">
                                                     <h3 className="text-lg font-medium text-foreground">Processing Document</h3>
                             <p className="text-muted-foreground">{processingMessage}</p>
                             <p className="text-sm text-muted-foreground">Extracting data with AI...</p>
                      </div>
                    </div>
                  ) : selectedFile ? (
                    <div className="space-y-4">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                      <div className="space-y-2">
                                                     <h3 className="text-lg font-medium text-foreground">Document Selected</h3>
                                                  <div className="bg-card border rounded-lg p-4">
                          <div className="flex items-center space-x-3">
                                                           <FileText className="w-8 h-8 text-muted-foreground" />
                            <div className="text-left">
                              <div className="font-medium">{selectedFile.name}</div>
                                                             <div className="text-sm text-muted-foreground">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • {selectedFile.type.split('/')[1].toUpperCase()}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-center space-x-3">
                          <Button onClick={processDocument} className="flex-1">
                            <Brain className="w-4 h-4 mr-2" />
                            Process Document
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => {
                              setSelectedFile(null);
                              setShowResults(false);
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                                                 <Upload className={`w-12 h-12 mx-auto ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                           <div>
                             <h3 className="text-lg font-medium text-foreground mb-2">
                          {isDragging ? 'Drop your document here' : 'Upload Delivery Order'}
                        </h3>
                                                     <p className="text-muted-foreground mb-4">Supports JPG, PNG, PDF formats</p>
                        <Button onClick={() => fileInputRef.current?.click()}>
                          <Upload className="w-4 h-4 mr-2" />
                          Choose File
                        </Button>
                                                     <p className="text-xs text-muted-foreground mt-4">
                          AI will extract: Supplier Name, PO Number, Project Number, Delivery Date, and Items
                        </p>
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
              </div>

              {/* Results Section */}
              {showResults && processedDocument && (
                <div className="pt-6 border-t">
                  <div className="flex items-center justify-between mb-4">
                                             <h3 className="text-lg font-medium text-foreground">Processing Results</h3>
                    <Badge variant="default">Success</Badge>
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium">File Name:</span> {processedDocument.renamedName}
                      </div>
                      <div>
                        <span className="font-medium">Supplier:</span> {processedDocument.supplier}
                      </div>
                      <div>
                        <span className="font-medium">PO Number:</span> {processedDocument.poNumber}
                      </div>
                      <div>
                        <span className="font-medium">Project:</span> {processedDocument.projectNumber}
                      </div>
                    </div>
                    
                    {/* Processing Analysis Info */}
                    {(processedDocument as any).processingType && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Processing Type:</span> {(processedDocument as any).processingType}
                          </div>
                          <div>
                            <span className="font-medium">File Analysis:</span> {(processedDocument as any).fileAnalysis}
                          </div>
                          <div>
                            <span className="font-medium">Document Type:</span> {(processedDocument as any).templateUsed}
                          </div>
                          <div>
                            <span className="font-medium">Processing Method:</span> {(processedDocument as any).processingMethod}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Extracted Data Table */}
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Extracted Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">Supplier Name</TableCell>
                          <TableCell>{processedDocument.extractedData?.supplier || 'Not found'}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">PO Number</TableCell>
                          <TableCell>{processedDocument.extractedData?.poNumber || 'Not found'}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Project Number</TableCell>
                          <TableCell>{processedDocument.extractedData?.projectNumber || 'Not found'}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Date</TableCell>
                          <TableCell>{processedDocument.extractedData?.date || 'Not found'}</TableCell>
                        </TableRow>
                        {processedDocument.extractedData?.deliveryDate && (
                          <TableRow>
                            <TableCell className="font-medium">Delivery Date</TableCell>
                            <TableCell>{processedDocument.extractedData.deliveryDate}</TableCell>
                          </TableRow>
                        )}
                        {processedDocument.extractedData?.totalAmount && (
                          <TableRow>
                            <TableCell className="font-medium">Total Amount</TableCell>
                            <TableCell>{processedDocument.extractedData.totalAmount}</TableCell>
                          </TableRow>
                        )}
                        {processedDocument.extractedData?.pageCount && processedDocument.extractedData.pageCount > 1 && (
                          <TableRow>
                            <TableCell className="font-medium">Pages</TableCell>
                            <TableCell>{processedDocument.extractedData.pageCount} pages (Multi-page document)</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {processedDocument.extractedData?.items && processedDocument.extractedData.items.length > 0 && (
                    <div className="mt-4">
                                                 <h4 className="font-medium text-foreground mb-2">Items Delivered</h4>
                      <div className="flex flex-wrap gap-2">
                        {processedDocument.extractedData.items.map((item, index) => (
                          <Badge key={index} variant="outline">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-6 flex justify-end space-x-3">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setShowResults(false);
                        setProcessedDocument(null);
                        setSelectedFile(null);
                      }}
                    >
                      Process Another Document
                    </Button>
                    <Button 
                      onClick={() => {
                        if (processedDocument) {
                          const csvContent = generateCSVFromDocument(processedDocument);
                          const blob = new Blob([csvContent], { type: 'text/csv' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${processedDocument.supplier}_${processedDocument.poNumber}_extracted_data.csv`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                        }
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Results
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Document Details Dialog */}
      <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <FileText className="w-5 h-5" />
              <span>Document Details</span>
            </DialogTitle>
            <DialogDescription>
              View extracted data and document information
            </DialogDescription>
          </DialogHeader>
          {selectedDocument && (
            <div className="space-y-6">
                                     <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="text-sm font-medium text-muted-foreground">Original Name</label>
                           <p className="text-sm text-foreground mt-1">{selectedDocument.originalName}</p>
                         </div>
                         <div>
                           <label className="text-sm font-medium text-muted-foreground">Renamed File</label>
                           <p className="text-sm text-foreground mt-1">{selectedDocument.renamedName}</p>
                         </div>
                         <div>
                           <label className="text-sm font-medium text-muted-foreground">Document Type</label>
                           <p className="text-sm text-foreground mt-1">{selectedDocument.type}</p>
                         </div>
                         <div>
                           <label className="text-sm font-medium text-muted-foreground">File Size</label>
                           <p className="text-sm text-foreground mt-1">{selectedDocument.fileSize}</p>
                         </div>
                       </div>

                               <div className="border-t pt-4">
                   <h4 className="font-medium text-foreground mb-3">Extracted Data</h4>
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-sm font-medium text-muted-foreground">Supplier Name</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.supplier || 'Not extracted'}</p>
                     </div>
                     <div>
                       <label className="text-sm font-medium text-muted-foreground">PO Number</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.poNumber || 'Not extracted'}</p>
                     </div>
                     <div>
                       <label className="text-sm font-medium text-muted-foreground">Project Number</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.projectNumber || 'Not extracted'}</p>
                     </div>
                     <div>
                       <label className="text-sm font-medium text-muted-foreground">Date</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.date || 'Not extracted'}</p>
                     </div>
                  {selectedDocument.extractedData?.deliveryDate && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Delivery Date</label>
                      <p className="text-sm text-gray-900 mt-1">{selectedDocument.extractedData.deliveryDate}</p>
                    </div>
                  )}
                  {selectedDocument.extractedData?.totalAmount && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Total Amount</label>
                      <p className="text-sm text-gray-900 mt-1">{selectedDocument.extractedData.totalAmount}</p>
                    </div>
                  )}
                </div>
                
                {selectedDocument.extractedData?.items && selectedDocument.extractedData.items.length > 0 && (
                  <div className="mt-4">
                    <label className="text-sm font-medium text-gray-700">Items Delivered</label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selectedDocument.extractedData.items.map((item, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowDocumentDialog(false)}>
                  Close
                </Button>
                <Button>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
