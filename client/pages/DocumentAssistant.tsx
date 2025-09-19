import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Link } from 'react-router-dom';

// Configure PDF.js worker with working URL
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;
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
  AlertCircle,
  Search,
  Filter,
  Calendar,
  Building,
  Hash,
  Trash2
} from 'lucide-react';
import { Card } from '@/components/ui/card';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  jobNumber: string;
  doNumber: string;
  extractedData: {
    supplier: string;
    poNumber: string;
    projectNumber: string;
    jobNumber: string;
    doNumber: string;
    date: string;
    deliveryDate?: string;
    items?: string[];
    pageCount?: number;
    confidence?: number;
  };
  fileSize: string;
  uploadTime: string;
  filePath?: string;
}

export default function DocumentAssistant() {
  // Multiple file processing states
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedDocuments, setProcessedDocuments] = useState<Document[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string>("");
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  
  // Detailed progress states
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [processingStage, setProcessingStage] = useState<string>("");
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>("");
  const [processingStartTime, setProcessingStartTime] = useState<number>(0);
  const [currentPageProgress, setCurrentPageProgress] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  
  // Document history and search states
  const [documentHistory, setDocumentHistory] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState<string>("all");
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Batch operations states
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  
  // UI states
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Enhanced progress tracking with accurate stage-based time estimation
  const updateProgress = (current: number, total: number, stage: string, startTime: number, stageType?: 'pdf_load' | 'page_render' | 'ocr' | 'backend' | 'complete') => {
    const progress = Math.round((current / total) * 100);
    setProcessingProgress(progress);
    setProcessingStage(stage);
    setCurrentPageProgress(current);
    setTotalPages(total);

    // Calculate estimated time remaining with stage-aware predictions
    const elapsed = Date.now() - startTime;

    if (current > 0) {
      // Calculate different time estimates based on processing stage
      let estimatedTotalTime = 0;
      let remainingTime = 0;

      if (stageType === 'pdf_load') {
        // PDF loading is typically 5-10% of total time
        estimatedTotalTime = elapsed / 0.08; // Assume PDF loading is 8% of total
        remainingTime = estimatedTotalTime - elapsed;
      } else if (stageType === 'page_render') {
        // Page rendering is typically 20-30% of total time
        const renderProgress = current / total;
        const renderTimeEstimate = elapsed / renderProgress;
        // Total time = render time (25%) + OCR time (65%) + backend (10%)
        estimatedTotalTime = renderTimeEstimate / 0.25;
        remainingTime = estimatedTotalTime - elapsed;
      } else if (stageType === 'ocr') {
        // OCR is the most time-consuming part (60-70% of total time)
        const ocrProgress = current / total;
        if (ocrProgress > 0.1) { // Only estimate after 10% OCR progress for accuracy
          const ocrTimeEstimate = elapsed / ocrProgress;
          // Adjust based on document complexity
          const complexityMultiplier = total > 5 ? 1.2 : total > 2 ? 1.1 : 1.0;
          estimatedTotalTime = (ocrTimeEstimate * complexityMultiplier) / 0.65; // OCR is 65% of total
          remainingTime = estimatedTotalTime - elapsed;
        } else {
          // Early OCR stage - use conservative estimate
          remainingTime = total * 45000; // 45 seconds per page average
        }
      } else if (stageType === 'backend') {
        // Backend processing is typically 5-15% of total time
        remainingTime = Math.max(5000, total * 2000); // 2-5 seconds per page for backend
      } else if (stageType === 'complete') {
        remainingTime = 0;
        setEstimatedTimeRemaining("Complete!");
        return;
      } else {
        // Fallback to original calculation for other stages
        const avgTimePerUnit = elapsed / current;
        remainingTime = (total - current) * avgTimePerUnit;

        // Apply complexity multipliers
        if (total > 5) {
          remainingTime *= 1.3; // Large documents take proportionally longer
        } else if (total > 2) {
          remainingTime *= 1.1; // Medium documents slight overhead
        }
      }

      // Format the remaining time display
      if (remainingTime <= 0) {
        setEstimatedTimeRemaining("Almost done...");
      } else if (remainingTime > 180000) { // > 3 minutes
        const minutes = Math.ceil(remainingTime / 60000);
        setEstimatedTimeRemaining(`~${minutes} min remaining`);
      } else if (remainingTime > 60000) { // > 1 minute
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.ceil((remainingTime % 60000) / 1000);
        setEstimatedTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')} remaining`);
      } else if (remainingTime > 10000) { // > 10 seconds
        const seconds = Math.ceil(remainingTime / 1000);
        setEstimatedTimeRemaining(`${seconds} seconds remaining`);
      } else if (remainingTime > 3000) { // > 3 seconds
        setEstimatedTimeRemaining("Almost done...");
      } else {
        setEstimatedTimeRemaining("Finalizing...");
      }
    } else {
      // Initial estimates based on document type and size
      if (total > 10) {
        setEstimatedTimeRemaining(`~${Math.ceil(total * 0.8)} min estimated (large document)`);
      } else if (total > 5) {
        setEstimatedTimeRemaining(`~${Math.ceil(total * 0.6)} min estimated`);
      } else if (total > 1) {
        setEstimatedTimeRemaining(`~${Math.ceil(total * 0.4)} min estimated`);
      } else {
        setEstimatedTimeRemaining("~30 sec estimated");
      }
    }
  };

  // Enhanced image preprocessing for better OCR quality - optimized for PO numbers and supplier names
  const enhanceImageForOCR = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): HTMLCanvasElement => {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Apply image enhancements optimized for text recognition
    for (let i = 0; i < data.length; i += 4) {
      // Convert to grayscale for better OCR performance
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);

      // Apply adaptive contrast enhancement for better text clarity
      const enhanced = Math.round(((gray / 255 - 0.5) * 2.0 + 0.5) * 255); // Increased contrast
      const finalValue = Math.max(0, Math.min(255, enhanced));

      // Apply binarization for cleaner text detection
      const threshold = 128; // Standard threshold for text separation
      const adjustedValue = finalValue > threshold ? 255 : 0; // Pure black/white for cleaner OCR

      data[i] = adjustedValue;     // Red
      data[i + 1] = adjustedValue; // Green
      data[i + 2] = adjustedValue; // Blue
      // Alpha remains unchanged
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
  };

  // PDF processing function with detailed progress tracking and enhanced OCR
  const processPDFWithTesseract = async (file: File): Promise<string> => {
    try {
      const startTime = Date.now();
      setProcessingStartTime(startTime);
      setProcessingStage("Loading PDF...");
      setProcessingProgress(0);
      updateProgress(0, 1, "Loading PDF document...", startTime, 'pdf_load');
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let combinedText = '';

      console.log(`Starting enhanced PDF processing for ${pdf.numPages} pages...`);
      setTotalPages(pdf.numPages);
      setProcessingStage("Processing PDF pages with enhanced OCR...");
      updateProgress(1, 1, "PDF loaded successfully", startTime, 'pdf_load');

      // Process each page of the PDF independently to prevent content mixing
      const pageTexts: string[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        console.log(`Processing page ${pageNum}/${pdf.numPages}...`);
        updateProgress(pageNum - 0.5, pdf.numPages, `Rendering page ${pageNum} of ${pdf.numPages}...`, startTime, 'page_render');

        try {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 3.0 }); // Reduced scale for stability

          // Create fresh canvas for each page
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('Could not create canvas context');
          }

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          // Enable image smoothing
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';

          // Clear canvas with white background
          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);

          // Render page to canvas
          await page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas
          }).promise;

          // Enhance image for OCR
          updateProgress(pageNum - 0.3, pdf.numPages, `Enhancing page ${pageNum} for OCR...`, startTime, 'page_render');
          const enhancedCanvas = enhanceImageForOCR(canvas, context);

          // Convert to blob
          const blob = await new Promise<Blob>((resolve) => {
            enhancedCanvas.toBlob((blob) => resolve(blob!), 'image/png', 1.0);
          });

          // OCR processing with fresh worker for each page
          updateProgress(pageNum - 0.1, pdf.numPages, `OCR processing page ${pageNum}...`, startTime, 'ocr');

          const { createWorker } = await import('tesseract.js');
          const worker = await createWorker('eng', 1, {
            logger: m => {
              if (m.status && m.progress !== undefined) {
                console.log(`Tesseract page ${pageNum}: ${m.status} - ${Math.round(m.progress * 100)}%`);
              }
            }
          });

          // Configure Tesseract
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,;:()[]{}+-*/%$#@!?&\'"\\n\\r\\t\\-_/ ',
            tessedit_pageseg_mode: 1 as any,
            tessedit_ocr_engine_mode: 1 as any,
            preserve_interword_spaces: '1',
            user_defined_dpi: '300'
          });

          const { data: { text, confidence } } = await worker.recognize(blob);
          await worker.terminate();

          // Log page results
          console.log(`\n=== PAGE ${pageNum} OCR RESULTS ===`);
          console.log(`Confidence: ${confidence}%`);
          console.log(`Text length: ${text.length} characters`);

          // Store clean page text
          pageTexts.push(text);

          console.log(`=== END PAGE ${pageNum} RESULTS ===\n`);

          updateProgress(pageNum, pdf.numPages, `Completed page ${pageNum} of ${pdf.numPages} (${confidence?.toFixed(1)}% confidence)`, startTime, 'ocr');

        } catch (pageError) {
          console.error(`Error processing page ${pageNum}:`, pageError);
          pageTexts.push(''); // Add empty text to maintain page order
          updateProgress(pageNum, pdf.numPages, `Error on page ${pageNum}, continuing...`, startTime);
        }
      }

      // Combine all page texts with clear separators
      combinedText = pageTexts.map((text, index) => {
        if (!text.trim()) return `\n=== PAGE ${index + 1} (PROCESSING ERROR) ===\n`;
        return `\n=== PAGE ${index + 1} START ===\n${text}\n=== PAGE ${index + 1} END ===\n`;
      }).join('\n');

      setProcessingStage("Finalizing document processing...");
      setProcessingProgress(100);
      updateProgress(pdf.numPages, pdf.numPages, "Document processing complete!", startTime, 'complete');
      
      console.log(`\n=== FINAL COMBINED PDF TEXT ===`);
      console.log(`Total text length: ${combinedText.length} characters`);
      console.log(`\n--- COMPLETE FINAL TEXT ---`);
      console.log(combinedText);
      console.log(`--- END COMPLETE FINAL TEXT ---\n`);
      console.log(`=== END FINAL PDF TEXT ===`);
      
      // OCR text extraction completed
      console.log('📁 OCR text extraction completed for analysis');

      return combinedText;
    } catch (error) {
      console.error('PDF processing error:', error);
      setProcessingStage("Error occurred during processing");
      throw new Error('Failed to process PDF with Tesseract OCR');
    }
  };

  // Preprocess extracted text to improve field detection
  const preprocessTextForExtraction = (rawText: string): string => {
    let processedText = rawText;

    // Clean up common OCR issues
    processedText = processedText
      .replace(/[|]/g, 'I') // Replace pipe characters that might be misread 'I's
      .replace(/FO([0-9]{5,6})/g, 'PO$1') // Fix F0 -> PO misreads
      .replace(/P\/0/gi, 'PO') // Fix P/0 -> PO
      .replace(/D\/O\s*ND/gi, 'DO_NUMBER') // Fix D/O ND pattern
      .replace(/[oO]([0-9])/g, '0$1') // Fix letter O in numbers
      .replace(/([0-9])[oO]/g, '$10') // Fix letter O at end of numbers
      .replace(/S([0-9])/g, '5$1') // Fix S misread as 5
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/([A-Z])([a-z])/g, '$1 $2') // Add space between capital and lowercase if missing

    // Enhance key patterns without heavy modification for backend compatibility
    processedText = processedText.replace(
      /Your order no\.:/gi,
      'PO Number:'
    );

    processedText = processedText.replace(
      /YOUR PO NO\.?\s*:/gi,
      'PO Number:'
    );

    // Enhance supplier company names to be more prominent
    processedText = processedText.replace(
      /(WAGO Electronic Pte Ltd|WAH LEI INDUSTRIAL SUPPLY CO\. PTE\. LTD|SCL System Enterprise Pte Ltd)/gi,
      'SUPPLIER: $1'
    );

    // Clean up delivery order patterns
    processedText = processedText.replace(
      /Delivery Order No\.?\s*:/gi,
      'DO Number:'
    );

    processedText = processedText.replace(
      /DO\s*NO\.?\s*:/gi,
      'DO Number:'
    );

    console.log('📋 Text preprocessing completed');
    console.log('🔍 PO patterns found:', (processedText.match(/PO Number:/g) || []).length);
    console.log('🏢 Supplier patterns found:', (processedText.match(/SUPPLIER:/g) || []).length);

    return processedText;
  };

  const handleFileSelect = (files: File[]) => {
    console.log("handleFileSelect called with files:", files);
    
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif', 'application/pdf'];
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Check file type
      if (!allowedTypes.includes(file.type)) {
        errors.push(`${file.name}: Invalid file format`);
        continue;
      }

      // Check file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        errors.push(`${file.name}: File too large (max 5MB)`);
        continue;
      }

      validFiles.push(file);
    }

    if (errors.length > 0) {
      setUploadError(errors.join(", "));
      return;
    }

    console.log("Files validated successfully:", validFiles.length);
    setSelectedFiles(validFiles);
    setShowResults(false);
    setUploadError("");
  };

  const handleDrop = (e: React.DragEvent) => {
    console.log("handleDrop called");
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    console.log("Dropped files:", files);
    if (files.length > 0) {
      handleFileSelect(files); // Process all files
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
      handleFileSelect(Array.from(files)); // Process all selected files
    }
  };

  const processDocuments = async () => {
    if (selectedFiles.length === 0) return;

    setIsProcessing(true);
    setUploadError("");
    setTotalFiles(selectedFiles.length);
    setCurrentProcessingIndex(0);
    const processedResults: Document[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setCurrentProcessingIndex(i + 1);
        
        console.log(`Processing file ${i + 1}/${selectedFiles.length}:`, file.name);

        // Update processing message based on file type with realistic time expectations
        if (file.type.startsWith("image/")) {
          setProcessingMessage(`Processing ${file.name}... (${i + 1}/${selectedFiles.length}) - Enhanced OCR for accurate data extraction`);
        } else if (file.type === "application/pdf") {
          setProcessingMessage(`Processing ${file.name}... (${i + 1}/${selectedFiles.length}) - Multi-page document processing may take several minutes`);
        } else {
          setProcessingMessage(`Processing ${file.name}... (${i + 1}/${selectedFiles.length}) - Processing document for data extraction`);
        }

        let response;
        
        // Handle PDF files with PDF.js + Tesseract
        if (file.type === "application/pdf") {
          console.log("Processing PDF file:", file.name);
          try {
            // Get PDF info first
            console.log("Loading PDF document...");
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const pageCount = pdf.numPages;
            console.log(`PDF loaded successfully: ${pageCount} pages`);
            
            // Extract text from all pages
            console.log("Extracting text from PDF pages...");
            const rawExtractedText = await processPDFWithTesseract(file);
            console.log(`Raw text extracted: ${rawExtractedText.length} characters`);

            // Preprocess text for better field extraction
            const extractedText = preprocessTextForExtraction(rawExtractedText);
            console.log(`Preprocessed text: ${extractedText.length} characters`);
            
            // Show a preview of what will be sent to server for extraction
            console.log(`\n=== SENDING TO SERVER FOR EXTRACTION ===`);
            console.log(`File: ${file.name}`);
            console.log(`Page count: ${pageCount}`);
            console.log(`Text preview (first 500 chars):`, extractedText.substring(0, 500));
            console.log(`Text contains PO numbers?: ${/PO\d+|P\.O\.|purchase.*order|order.*no/i.test(extractedText)}`);
            console.log(`Text contains suppliers?: ${/electronic|pte ltd|company|supplier/i.test(extractedText)}`);
            console.log(`=== END SERVER PREVIEW ===\n`);
            
            // Send the original PDF file along with the extracted text
            const formData = new FormData();
            formData.append("document", file);
            formData.append("extractedText", extractedText);
            formData.append("pageCount", pageCount.toString());
            
            console.log("Sending PDF data to server with extractedText and pageCount");
            updateProgress(pdf.numPages, pdf.numPages, "Sending to server for data extraction...", startTime, 'backend');
            response = await fetch("/api/process-document", {
              method: "POST",
              body: formData,
            });
          } catch (error) {
            console.error("PDF processing failed:", error);
            console.error("Error details:", error.stack);
            // Don't throw error, fall back to normal file upload
            console.log("Falling back to normal file upload...");
            const formData = new FormData();
            formData.append("document", file);
            
            response = await fetch("/api/process-document", {
              method: "POST", 
              body: formData,
            });
          }
        } else {
          // Handle image files with progress tracking
          console.log("Processing image file:", file.name);
          
          // Start progress tracking for images
          const startTime = Date.now();
          setProcessingStartTime(startTime);
          setProcessingStage("Preparing image for processing...");
          setProcessingProgress(10);
          setTotalPages(1); // Images are single page
          setEstimatedTimeRemaining("Processing...");
          
          const formData = new FormData();
          formData.append("document", file);

          // Update progress during processing
          updateProgress(0.3, 1, "Uploading image to server...", startTime, 'backend');
          
          // Call the API endpoint with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
          
          updateProgress(0.5, 1, "Server processing document...", startTime, 'backend');
          
          response = await fetch("/api/process-document", {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          updateProgress(1, 1, "Image processing completed!", startTime, 'complete');
        }

        if (!response.ok) {
          let errorMessage = `HTTP error! status: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.details || errorMessage;
          } catch (parseError) {
            errorMessage = response.statusText || errorMessage;
          }
          console.error(`Error processing ${file.name}:`, errorMessage);
          continue; // Skip this file and continue with others
        }

        const result = await response.json();
        console.log(`API response for ${file.name}:`, result);

        // Check if this is a multi-document response
        if (result.multiDocument && result.results) {
          console.log(`Multi-document response: ${result.processedCount} documents found`);
          
          // Process each document in the multi-document response
          for (const docResult of result.results) {
            // Prioritize extractedData over top-level fields for accurate display
            const extractedData = docResult.extractedData || {};
            const document: Document = {
              id: docResult.id,
              originalName: docResult.originalName,
              renamedName: docResult.renamedName,
              type: "Delivery Order",
              fileSize: `${(docResult.fileSize / 1024 / 1024).toFixed(1)} MB`,
              status: docResult.status,
              // Use extractedData first, fallback to top-level fields, then "Not found"
              supplier: extractedData.supplier || docResult.supplier || "Not found",
              poNumber: extractedData.poNumber || docResult.poNumber || "Not found",
              projectNumber: extractedData.projectNumber || docResult.projectNumber || "Not found",
              jobNumber: extractedData.jobNumber || docResult.jobNumber || '',
              doNumber: extractedData.doNumber || docResult.doNumber || '',
              date: extractedData.date || docResult.date || "Not found",
              extractedData: docResult.extractedData,
              filePath: docResult.filePath,
              uploadTime: new Date().toLocaleString(),
            };

            // Add processing analysis info
            const enhancedDocument = {
              ...document,
              processingType: file.type.startsWith('image/') ? 'Image Analysis' : 'Document Analysis (Multi-Page)',
              fileAnalysis: `File: ${docResult.originalName} (${(file.size / 1024).toFixed(1)} KB)`,
              templateUsed: `Page ${docResult.extractedData?.rawData?.pageIndex || 1} from Multi-page PDF`,
              processingMethod: 'Multi-Page Document Processing',
              confidence: docResult.extractedData?.confidence ? `${(docResult.extractedData.confidence * 100).toFixed(1)}%` : 'N/A'
            };
            
            processedResults.push(enhancedDocument);
          }
        } else {
          // Single document response (existing logic)
          // Prioritize extractedData over top-level fields for accurate display
          const extractedData = result.extractedData || {};
          const document: Document = {
            id: result.id,
            originalName: result.originalName,
            renamedName: result.renamedName,
            type: "Delivery Order",
            fileSize: `${(result.fileSize / 1024 / 1024).toFixed(1)} MB`,
            status: result.status,
            // Use extractedData first, fallback to top-level fields, then "Not found"
            supplier: extractedData.supplier || result.supplier || "Not found",
            poNumber: extractedData.poNumber || result.poNumber || "Not found",
            projectNumber: extractedData.projectNumber || result.projectNumber || "Not found",
            jobNumber: extractedData.jobNumber || result.jobNumber || '',
            doNumber: extractedData.doNumber || result.doNumber || '',
            date: extractedData.date || result.date || "Not found",
            extractedData: result.extractedData,
            filePath: result.filePath,
            uploadTime: new Date().toLocaleString(),
          };

          // Add processing analysis info
          const enhancedDocument = {
            ...document,
            processingType: file.type.startsWith('image/') ? 'Image Analysis' : 'Document Analysis',
            fileAnalysis: `File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
            templateUsed: document.extractedData?.pageCount > 1 ? 'Multi-page Document' : 'Single Page Document',
            processingMethod: file.type.startsWith('image/') ? 'Image Processing' : 'Document Processing',
            confidence: document.extractedData?.confidence ? `${(document.extractedData.confidence * 100).toFixed(1)}%` : 'N/A'
          };
          
          processedResults.push(enhancedDocument);
        }
        console.log(`Successfully processed ${file.name}`);
      }
      
      setProcessedDocuments(processedResults);
      setShowResults(true);
      
      // Add to document history
      setDocumentHistory(prev => [...processedResults, ...prev]);
      
      console.log(`Successfully processed ${processedResults.length} documents`);

    } catch (error) {
      console.error("Document processing error:", error);
      
      let errorMessage = "Failed to process documents";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = "Request timed out. Please try again with smaller files or check your connection.";
        } else {
          errorMessage = error.message;
        }
      }
      
      setUploadError(errorMessage);
    } finally {
      setSelectedFiles([]);
      setIsProcessing(false);
      setProcessingMessage("");
      setCurrentProcessingIndex(0);
      setTotalFiles(0);
      
      // Reset detailed progress states
      setProcessingProgress(0);
      setProcessingStage("");
      setEstimatedTimeRemaining("");
      setProcessingStartTime(0);
      setCurrentPageProgress(0);
      setTotalPages(0);

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
    
    // Basic document information rows
    const basicRows = [
      ['Document Information', ''],
      ['Original File Name', doc.originalName],
      ['Processed File Name', doc.renamedName],
      ['File Size', doc.fileSize],
      ['Processing Date', doc.uploadTime],
      ['Number of Pages', doc.extractedData?.pageCount ? `${doc.extractedData.pageCount} pages` : '1 page'],
      ['', ''], // Empty row separator
      ['Extracted Data', ''],
      ['Supplier Name', doc.supplier || doc.extractedData?.supplier || 'Not found'],
      ['PO Number', doc.poNumber || doc.extractedData?.poNumber || 'Not found'],
      ['Project Number', doc.projectNumber || doc.extractedData?.projectNumber || 'Not found'],
      ['Job Number', doc.jobNumber || doc.extractedData?.jobNumber || 'Not found'],
      ['DO Number', doc.doNumber || doc.extractedData?.doNumber || 'Not found'],
      ['Date', doc.date || doc.extractedData?.date || 'Not found'],
      ['Delivery Date', doc.extractedData?.deliveryDate || 'Not found'],
    ];

    // Handle items - list them individually if there are any
    const itemRows: string[][] = [];
    if (doc.extractedData?.items && doc.extractedData.items.length > 0) {
      itemRows.push(['', '']); // Empty row separator
      itemRows.push(['Items Delivered', '']);
      itemRows.push(['Total Items Found', `${doc.extractedData.items.length} items`]);
      itemRows.push(['', '']); // Another separator
      
      // List each item individually with numbering
      doc.extractedData.items.forEach((item, index) => {
        itemRows.push([`Item ${index + 1}`, item.trim()]);
      });
    } else {
      itemRows.push(['', '']);
      itemRows.push(['Items Delivered', 'No items found']);
    }

    // Combine all rows
    const allRows = [...basicRows, ...itemRows];
    
    const csvContent = [
      headers.join(','),
      ...allRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csvContent;
  };

  // Load document history on component mount
  useEffect(() => {
    loadDocumentHistory();
  }, []);

  // Filter documents based on search query and filter
  useEffect(() => {
    filterDocuments();
  }, [searchQuery, searchFilter, documentHistory]);

  const loadDocumentHistory = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/documents');
      if (response.ok) {
        const documents = await response.json();
        setDocumentHistory(documents);
      }
    } catch (error) {
      console.error('Failed to load document history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterDocuments = () => {
    let filtered = documentHistory;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(doc => {
        switch (searchFilter) {
          case 'supplier':
            return doc.supplier.toLowerCase().includes(query) || 
                   doc.extractedData?.supplier?.toLowerCase().includes(query);
          case 'poNumber':
            return doc.poNumber.toLowerCase().includes(query) || 
                   doc.extractedData?.poNumber?.toLowerCase().includes(query);
          case 'projectNumber':
            return doc.projectNumber.toLowerCase().includes(query) || 
                   doc.extractedData?.projectNumber?.toLowerCase().includes(query);
          case 'jobNumber':
            return doc.jobNumber.toLowerCase().includes(query) || 
                   doc.extractedData?.jobNumber?.toLowerCase().includes(query);
          case 'doNumber':
            return doc.doNumber.toLowerCase().includes(query) || 
                   doc.extractedData?.doNumber?.toLowerCase().includes(query);
          case 'filename':
            return doc.originalName.toLowerCase().includes(query) || 
                   doc.renamedName.toLowerCase().includes(query);
          default:
            return doc.supplier.toLowerCase().includes(query) ||
                   doc.poNumber.toLowerCase().includes(query) ||
                   doc.projectNumber.toLowerCase().includes(query) ||
                   doc.jobNumber.toLowerCase().includes(query) ||
                   doc.doNumber.toLowerCase().includes(query) ||
                   doc.originalName.toLowerCase().includes(query) ||
                   doc.renamedName.toLowerCase().includes(query) ||
                   doc.extractedData?.supplier?.toLowerCase().includes(query) ||
                   doc.extractedData?.poNumber?.toLowerCase().includes(query) ||
                   doc.extractedData?.projectNumber?.toLowerCase().includes(query) ||
                   doc.extractedData?.jobNumber?.toLowerCase().includes(query) ||
                   doc.extractedData?.doNumber?.toLowerCase().includes(query);
        }
      });
    }

    setFilteredDocuments(filtered);
  };

  const downloadDocument = async (doc: Document) => {
    console.log('CSV download button clicked for document:', doc);
    console.log('Document ID:', doc.id);
    
    try {
      const response = await fetch(`/api/documents/${doc.id}/download`);
      console.log('CSV download response:', response);
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${doc.supplier || 'Unknown'}_${doc.poNumber || 'Unknown'}_extracted_data.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        console.log('CSV download triggered successfully');
      } else {
        const errorText = await response.text();
        console.error('CSV download failed:', response.status, errorText);
        alert(`CSV download failed: ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to download CSV:', error);
      alert('Failed to download CSV: ' + error.message);
    }
  };

  const handleDeleteClick = (doc: Document) => {
    setDocumentToDelete(doc);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!documentToDelete) return;
    
    try {
      const response = await fetch(`/api/documents/${documentToDelete.id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        // Remove document from both states
        setDocumentHistory(prev => prev.filter(doc => doc.id !== documentToDelete.id));
        setFilteredDocuments(prev => prev.filter(doc => doc.id !== documentToDelete.id));
        setShowDeleteDialog(false);
        setDocumentToDelete(null);
        console.log('Document deleted successfully');
      } else {
        const errorText = await response.text();
        console.error('Delete failed:', response.status, errorText);
        alert(`Delete failed: ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to delete document:', error);
      alert('Failed to delete document: ' + error.message);
    }
  };

  // Batch operations functions
  const toggleDocumentSelection = (docId: string) => {
    const newSelection = new Set(selectedDocuments);
    if (newSelection.has(docId)) {
      newSelection.delete(docId);
    } else {
      newSelection.add(docId);
    }
    setSelectedDocuments(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedDocuments.size === filteredDocuments.length) {
      // Deselect all
      setSelectedDocuments(new Set());
    } else {
      // Select all visible documents
      const allIds = new Set(filteredDocuments.map(doc => doc.id));
      setSelectedDocuments(allIds);
    }
  };

  const clearSelection = () => {
    setSelectedDocuments(new Set());
  };

  const batchDownloadCSV = async () => {
    if (selectedDocuments.size === 0) return;
    
    try {
      const selectedDocs = documentHistory.filter(doc => selectedDocuments.has(doc.id));
      
      // Download each document as a separate CSV file
      for (const doc of selectedDocs) {
        // Use the same CSV generation logic as the individual download
        const csvRows = [
          ['Document Information', ''],
          ['File Name', doc.renamedName || doc.originalName],
          ['Original Name', doc.originalName],
          ['File Type', doc.type || 'Unknown'],
          ['File Size', doc.fileSize || 'Unknown'],
          ['Processing Date', doc.uploadTime],
          ['Number of Pages', doc.extractedData?.pageCount ? `${doc.extractedData.pageCount} pages` : '1 page'],
          ['', ''], // Empty row separator
          ['Extracted Data', ''],
          ['Supplier Name', doc.extractedData?.supplier || 'Not found'],
          ['PO Number', doc.extractedData?.poNumber || 'Not found'],
          ['Project Number', doc.extractedData?.projectNumber || 'Not found'],
          ['Job Number', doc.extractedData?.jobNumber || 'Not found'],
          ['DO Number', doc.extractedData?.doNumber || 'Not found'],
          ['Date', doc.extractedData?.date || 'Not found'],
          ['Delivery Date', doc.extractedData?.deliveryDate || 'Not found'],
        ];

        // Handle items - list them individually if there are any
        const itemRows: string[][] = [];
        if (doc.extractedData?.items && doc.extractedData.items.length > 0) {
          itemRows.push(['', '']); // Empty row separator
          itemRows.push(['Items Extracted', '']);
          doc.extractedData.items.forEach((item, index) => {
            itemRows.push([`Item ${index + 1}`, item]);
          });
        } else {
          itemRows.push(['', ''], ['Items Extracted', 'No items found']);
        }

        const allRows = [...csvRows, ...itemRows];
        const csvContent = allRows.map(row => 
          row.map(field => `"${field}"`).join(',')
        ).join('\n');

        // Download individual CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        // Generate filename based on document data
        const supplierName = doc.extractedData?.supplier?.replace(/[^a-zA-Z0-9]/g, '_') || 'Unknown';
        const poNumber = doc.extractedData?.poNumber?.replace(/[^a-zA-Z0-9]/g, '_') || 'Unknown';
        const timestamp = new Date().toISOString().split('T')[0];
        link.setAttribute('download', `${supplierName}_${poNumber}_${timestamp}.csv`);
        
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Small delay between downloads to prevent browser blocking
        if (selectedDocs.indexOf(doc) < selectedDocs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Clear selection after all downloads complete
      clearSelection();
      alert(`Successfully downloaded ${selectedDocs.length} CSV files`);
      
    } catch (error) {
      console.error('Failed to download batch CSV:', error);
      alert('Failed to download batch CSV: ' + error.message);
    }
  };

  const batchDelete = async () => {
    if (selectedDocuments.size === 0) return;
    
    const confirmMessage = `Are you sure you want to delete ${selectedDocuments.size} selected document(s)? This action cannot be undone.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      const deletePromises = Array.from(selectedDocuments).map(async (docId) => {
        const response = await fetch(`/api/documents/${docId}`, {
          method: 'DELETE',
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to delete document ${docId}: ${errorText}`);
        }
        
        return docId;
      });
      
      const deletedIds = await Promise.all(deletePromises);
      
      // Remove all deleted documents from both states
      setDocumentHistory(prev => prev.filter(doc => !deletedIds.includes(doc.id)));
      setFilteredDocuments(prev => prev.filter(doc => !deletedIds.includes(doc.id)));
      
      // Clear selection
      clearSelection();
      
      alert(`Successfully deleted ${deletedIds.length} document(s)`);
      
    } catch (error) {
      console.error('Failed to delete documents:', error);
      alert('Failed to delete some documents: ' + error.message);
    }
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
        <div className="max-w-6xl mx-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="upload" className="flex items-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Process Document</span>
              </TabsTrigger>
              <TabsTrigger value="search" className="flex items-center space-x-2">
                <Search className="w-4 h-4" />
                <span>Search Documents ({documentHistory.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload">
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
                      : selectedFiles.length > 0
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
                    accept=".jpg,.jpeg,.png,.tif,.tiff,.pdf"
                    multiple
                    onChange={handleFileInputChange}
                  />

                  {isProcessing ? (
                    <div className="space-y-6">
                      <Loader2 className="w-12 h-12 text-blue-500 mx-auto animate-spin" />
                      <div className="space-y-4">
                        <h3 className="text-lg font-medium text-foreground">Processing Document</h3>
                        
                        {/* Overall Progress */}
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Overall Progress</span>
                            <span className="font-medium text-foreground">{processingProgress}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2.5">
                            <div 
                              className="bg-blue-500 h-2.5 rounded-full transition-all duration-500 ease-out" 
                              style={{ width: `${processingProgress}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* Current Stage */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">{processingStage}</p>
                            {processingProgress > 0 && processingProgress < 100 && (
                              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                <span>Processing...</span>
                              </div>
                            )}
                          </div>
                          {totalPages > 1 ? (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Page {Math.ceil(currentPageProgress)} of {totalPages}</span>
                              <span>{((currentPageProgress / totalPages) * 100).toFixed(0)}% pages complete</span>
                            </div>
                          ) : totalPages === 1 && (
                            <p className="text-xs text-muted-foreground">
                              Single page document
                            </p>
                          )}
                        </div>

                        {/* Time Remaining */}
                        {estimatedTimeRemaining && (
                          <div className="bg-muted/30 rounded-lg p-3 border">
                            <div className="flex items-center justify-center space-x-2">
                              <span className="text-lg">⏱️</span>
                              <div className="text-center">
                                <p className="text-sm font-medium text-foreground">{estimatedTimeRemaining}</p>
                                {processingProgress > 0 && processingProgress < 100 && (
                                  <p className="text-xs text-muted-foreground">
                                    {processingProgress < 20 ? "Getting started..." :
                                     processingProgress < 50 ? "Making good progress..." :
                                     processingProgress < 80 ? "Almost there..." :
                                     "Finishing up..."}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Processing Method Info */}
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground">
                            {totalPages > 1 ? 'Multi-page document processing' : 
                             totalPages === 1 && selectedFiles.length > 0 && selectedFiles[currentProcessingIndex - 1]?.type.startsWith('image/') ? 'Image document processing' : 
                             'Document processing'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : selectedFiles.length > 0 ? (
                    <div className="space-y-4">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                      <div className="space-y-2">
                        <h3 className="text-lg font-medium text-foreground">
                          {selectedFiles.length} Document{selectedFiles.length > 1 ? 's' : ''} Selected
                        </h3>
                        <div className="bg-card border rounded-lg p-4 max-h-48 overflow-y-auto">
                          {selectedFiles.map((file, index) => (
                            <div key={index} className="flex items-center space-x-3 py-2 border-b border-border last:border-b-0">
                              <FileText className="w-6 h-6 text-muted-foreground" />
                              <div className="flex-1 text-left">
                                <div className="font-medium text-sm">{file.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type.split('/')[1].toUpperCase()}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-center space-x-3">
                          <Button onClick={processDocuments} className="flex-1">
                            <Brain className="w-4 h-4 mr-2" />
                            Process {selectedFiles.length} Document{selectedFiles.length > 1 ? 's' : ''}
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => {
                              setSelectedFiles([]);
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
                          {isDragging ? 'Drop your documents here' : 'Upload Delivery Orders'}
                        </h3>
                                                     <p className="text-muted-foreground mb-4">Intelligent document processing • Supports multiple JPG, PNG, TIFF, PDF files</p>
                          <Button onClick={() => fileInputRef.current?.click()}>
                            <Upload className="w-4 h-4 mr-2" />
                          Choose Files
                          </Button>
                                                     <p className="text-xs text-muted-foreground mt-4">
                          AI will automatically extract: Supplier Name, PO Number, Project Number, Job Number, DO Number, Delivery Date, and Items<br/>
                          <span className="text-primary font-medium">✓ Advanced AI Processing</span>
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
              {showResults && processedDocuments.length > 0 && (
                <div className="pt-6 border-t">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-foreground">
                      Processing Results ({processedDocuments.length} document{processedDocuments.length > 1 ? 's' : ''})
                    </h3>
                    <Badge variant="default">Success</Badge>
                  </div>
                  
                  <div className="space-y-4">
                    {processedDocuments.map((processedDocument, index) => (
                      <div key={index} className="bg-card border rounded-lg p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium text-foreground">Document {index + 1}</h4>
                            <div className="flex space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openDocument(processedDocument)}
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
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
                                }}
                                title="Download CSV"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="font-medium text-muted-foreground">File Name:</span> 
                              <p className="text-foreground">{processedDocument.renamedName}</p>
                            </div>
                            <div>
                              <span className="font-medium text-muted-foreground">Supplier:</span> 
                              <p className="text-foreground">{processedDocument.supplier}</p>
                            </div>
                            <div>
                              <span className="font-medium text-muted-foreground">PO Number:</span> 
                              <p className="text-foreground">{processedDocument.poNumber}</p>
                            </div>
                            <div>
                              <span className="font-medium text-muted-foreground">Project:</span> 
                              <p className="text-foreground">{processedDocument.projectNumber || 'Not found'}</p>
                            </div>
                          </div>
                          
                          {/* Processing Analysis Info */}
                          {(processedDocument as any).processingType && (
                            <div className="pt-3 border-t">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="font-medium">Processing:</span> {(processedDocument as any).processingMethod}
                                </div>
                                <div>
                                  <span className="font-medium">Confidence:</span> {(processedDocument as any).confidence}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>


                  {/* Action Buttons */}
                  <div className="mt-6 flex justify-end space-x-3">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setShowResults(false);
                        setProcessedDocuments([]);
                        setSelectedFiles([]);
                      }}
                    >
                      Process More Documents
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setActiveTab("search");
                      }}
                      title="View All Documents"
                    >
                      <Search className="w-4 h-4" />
                    </Button>
                    <Button 
                      onClick={() => {
                        // Download all documents as a combined CSV
                        const allCsvContent = processedDocuments.map((doc, index) => {
                          const csvContent = generateCSVFromDocument(doc);
                          return `Document ${index + 1}: ${doc.originalName}\n${csvContent}\n\n`;
                        }).join('');
                        
                        const blob = new Blob([allCsvContent], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `batch_processed_documents_${new Date().toISOString().split('T')[0]}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                      }}
                      title="Download All Results"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
              </Card>
            </TabsContent>

            <TabsContent value="search">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-foreground">Document Search</h2>
                  <Badge variant="outline">{filteredDocuments.length} documents</Badge>
                </div>

                {/* Search Interface */}
                <div className="space-y-4 mb-6">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <div className="relative">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search documents..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                    </div>
                    <div className="w-full sm:w-48">
                      <Select value={searchFilter} onValueChange={setSearchFilter}>
                        <SelectTrigger>
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue placeholder="Filter by..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Fields</SelectItem>
                          <SelectItem value="supplier">Supplier Name</SelectItem>
                          <SelectItem value="poNumber">PO Number</SelectItem>
                          <SelectItem value="projectNumber">Project Number</SelectItem>
                          <SelectItem value="jobNumber">Job Number</SelectItem>
                          <SelectItem value="doNumber">DO Number</SelectItem>
                          <SelectItem value="filename">File Name</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Batch Actions Bar */}
                {filteredDocuments.length > 0 && (
                  <div className="mb-4 p-4 bg-muted/50 rounded-lg border border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <span className="text-sm font-medium text-foreground">
                          {selectedDocuments.size > 0 
                            ? `${selectedDocuments.size} document(s) selected`
                            : 'No documents selected'
                          }
                        </span>
                        {selectedDocuments.size > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={clearSelection}
                          >
                            Clear Selection
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={batchDownloadCSV}
                          disabled={selectedDocuments.size === 0}
                          className="flex items-center space-x-2"
                        >
                          <Download className="w-4 h-4" />
                          <span>Download CSV</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={batchDelete}
                          disabled={selectedDocuments.size === 0}
                          className="flex items-center space-x-2 text-destructive hover:text-destructive disabled:text-muted-foreground"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete Selected</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Document List */}
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">
                      {documentHistory.length === 0 ? 'No documents yet' : 'No documents found'}
                    </h3>
                    <p className="text-muted-foreground">
                      {documentHistory.length === 0 
                        ? 'Process your first document to see it appear here'
                        : 'Try adjusting your search terms or filters'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Select All Header */}
                    {filteredDocuments.length > 0 && (
                      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-primary bg-background border-border rounded focus:ring-primary"
                            checked={selectedDocuments.size > 0 && selectedDocuments.size === filteredDocuments.length}
                            onChange={toggleSelectAll}
                            title={selectedDocuments.size === filteredDocuments.length ? 'Deselect All' : 'Select All'}
                          />
                          <span className="text-sm font-medium text-foreground">
                            {selectedDocuments.size === filteredDocuments.length ? 'Deselect All' : 'Select All'} 
                            ({filteredDocuments.length} documents)
                          </span>
                        </div>
                        {selectedDocuments.size > 0 && (
                          <span className="text-sm text-muted-foreground">
                            {selectedDocuments.size} selected
                          </span>
                        )}
                      </div>
                    )}
                    
                    {filteredDocuments.map((doc) => (
                      <Card key={doc.id} className={`p-4 hover:shadow-md transition-shadow ${selectedDocuments.has(doc.id) ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-primary bg-background border-border rounded focus:ring-primary mt-1"
                              checked={selectedDocuments.has(doc.id)}
                              onChange={() => toggleDocumentSelection(doc.id)}
                              title={selectedDocuments.has(doc.id) ? 'Deselect document' : 'Select document'}
                            />
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center space-x-3">
                                <FileText className="w-5 h-5 text-muted-foreground" />
                                <div>
                                <h4 className="font-medium text-foreground">{doc.renamedName}</h4>
                                <p className="text-sm text-muted-foreground">{doc.originalName}</p>
                              </div>
                              <Badge variant={doc.status === 'Processed' ? 'default' : 'secondary'}>
                                {doc.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                              <div className="flex items-center space-x-2">
                                <Building className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">Supplier:</span>
                                <span>{doc.supplier || 'Not extracted'}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Hash className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">PO:</span>
                                <span>{doc.poNumber || 'Not extracted'}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Calendar className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">Date:</span>
                                <span>{doc.date || 'Not extracted'}</span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                              <span>Size: {doc.fileSize}</span>
                              <span>Processed: {doc.uploadTime}</span>
                              {doc.filePath && (
                                <span>Path: {doc.filePath}</span>
                              )}
                            </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 ml-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openDocument(doc)}
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => downloadDocument(doc)}
                              title="Download CSV"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteClick(doc)}
                              title="Delete Document"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
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
                       <label className="text-sm font-medium text-muted-foreground">Job Number</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.jobNumber || 'Not extracted'}</p>
                  </div>
                  <div>
                       <label className="text-sm font-medium text-muted-foreground">DO Number</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.doNumber || 'Not extracted'}</p>
                  </div>
                  <div>
                       <label className="text-sm font-medium text-muted-foreground">Date</label>
                       <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData?.date || 'Not extracted'}</p>
                  </div>
                  {selectedDocument.extractedData?.deliveryDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Delivery Date</label>
                      <p className="text-sm text-foreground mt-1">{selectedDocument.extractedData.deliveryDate}</p>
                    </div>
                  )}
                </div>
                
                {selectedDocument.extractedData?.items && selectedDocument.extractedData.items.length > 0 && (
                  <div className="mt-4">
                    <label className="text-sm font-medium text-muted-foreground">Items Delivered</label>
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
                <Button
                  onClick={() => downloadDocument(selectedDocument)}
                  title="Download CSV"
                >
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{documentToDelete?.originalName}"?
              This action cannot be undone and will permanently remove the document and its extracted data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
