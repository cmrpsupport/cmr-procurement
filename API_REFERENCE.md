# CMR Procurement System - API Reference

## Table of Contents

1. [Server API Endpoints](#server-api-endpoints)
2. [Client API Functions](#client-api-functions)
3. [Database API](#database-api)
4. [Component APIs](#component-apis)
5. [Hook APIs](#hook-apis)
6. [Utility Functions](#utility-functions)
7. [Type Definitions](#type-definitions)
8. [Error Codes](#error-codes)

## Server API Endpoints

### Health Check

#### GET /health

Returns server health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Status Codes:**
- `200` - Server is healthy

---

### Demo Endpoint

#### GET /api/demo

Returns a demo message for testing connectivity.

**Response:**
```json
{
  "message": "Hello from Express server"
}
```

**Status Codes:**
- `200` - Success

---

### Document Processing

#### POST /api/process-document

Processes a single document (image or PDF) and extracts structured data.

**Request:**
```http
POST /api/process-document
Content-Type: multipart/form-data

FormData:
- document: File (required) - Image or PDF file
- extractedText: string (optional) - Pre-extracted text for PDFs
- pageCount: number (optional) - Number of pages for PDFs
```

**Supported File Types:**
- Images: `image/jpeg`, `image/jpg`, `image/png`, `image/tiff`, `image/tif`
- PDFs: `application/pdf`
- Maximum file size: 10MB

**Response:**
```json
{
  "id": "1705312200000",
  "originalName": "delivery_order.pdf",
  "renamedName": "WAGO_Electronic_Pte_Ltd_PO55903_delivery_order.pdf",
  "type": "application/pdf",
  "fileSize": 2048576,
  "status": "Processed",
  "supplier": "WAGO Electronic Pte Ltd",
  "poNumber": "PO55903",
  "projectNumber": "PRJ-2024-001",
  "jobNumber": "JOB-25006YB",
  "doNumber": "D2508040",
  "date": "15/01/2024",
  "extractedData": {
    "supplier": "WAGO Electronic Pte Ltd",
    "poNumber": "PO55903",
    "projectNumber": "PRJ-2024-001",
    "jobNumber": "JOB-25006YB",
    "doNumber": "D2508040",
    "date": "15/01/2024",
    "deliveryDate": "20/01/2024",
    "items": [
      "Terminal Block 2.5mm",
      "Disconnect Switch 32A",
      "Test Point Connector"
    ],
    "pageCount": 2,
    "confidence": 0.85,
    "documentType": "Delivery Order",
    "currency": "S$",
    "totalAmount": "S$1,250.00"
  },
  "filePath": null
}
```

**Status Codes:**
- `200` - Document processed successfully
- `400` - Invalid file or missing file
- `500` - Processing error

**Error Response:**
```json
{
  "error": "Failed to process document",
  "details": "OCR engine not available",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

#### POST /api/process-documents

Processes multiple documents in batch.

**Request:**
```http
POST /api/process-documents
Content-Type: multipart/form-data

FormData:
- documents: File[] (required) - Array of files (max 10)
```

**Response:**
```json
{
  "results": [
    {
      "id": "1705312200001",
      "originalName": "doc1.pdf",
      "renamedName": "Supplier1_PO001_doc1.pdf",
      "status": "Processed",
      "supplier": "Supplier1",
      "poNumber": "PO001",
      "extractedData": { /* ... */ }
    }
  ],
  "processedCount": 1
}
```

**Status Codes:**
- `200` - Documents processed successfully
- `400` - No files uploaded
- `500` - Processing error

---

### Document Management

#### GET /api/documents

Retrieves all processed documents.

**Response:**
```json
[
  {
    "id": "1705312200000",
    "originalName": "delivery_order.pdf",
    "renamedName": "WAGO_Electronic_Pte_Ltd_PO55903_delivery_order.pdf",
    "type": "application/pdf",
    "fileSize": 2048576,
    "status": "Processed",
    "supplier": "WAGO Electronic Pte Ltd",
    "poNumber": "PO55903",
    "projectNumber": "PRJ-2024-001",
    "date": "15/01/2024",
    "extractedData": {
      "supplier": "WAGO Electronic Pte Ltd",
      "poNumber": "PO55903",
      "items": ["Terminal Block 2.5mm", "Disconnect Switch 32A"],
      "pageCount": 2
    },
    "uploadTime": "1/15/2024, 10:30:00 AM"
  }
]
```

**Status Codes:**
- `200` - Success
- `500` - Database error

---

#### GET /api/documents/:id

Retrieves a specific document by ID.

**Parameters:**
- `id` (string, required) - Document ID

**Response:**
```json
{
  "id": "1705312200000",
  "originalName": "delivery_order.pdf",
  "renamedName": "WAGO_Electronic_Pte_Ltd_PO55903_delivery_order.pdf",
  "type": "application/pdf",
  "fileSize": 2048576,
  "status": "Processed",
  "supplier": "WAGO Electronic Pte Ltd",
  "poNumber": "PO55903",
  "extractedData": {
    "supplier": "WAGO Electronic Pte Ltd",
    "poNumber": "PO55903",
    "items": ["Terminal Block 2.5mm", "Disconnect Switch 32A"],
    "pageCount": 2
  }
}
```

**Status Codes:**
- `200` - Document found
- `404` - Document not found
- `500` - Database error

---

#### GET /api/documents/:id/download

Downloads document data as CSV.

**Parameters:**
- `id` (string, required) - Document ID

**Response:**
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="supplier_po_extracted_data.csv"`

**CSV Format:**
```csv
Field,Extracted Value
Document Information,
Original File Name,delivery_order.pdf
Processed File Name,WAGO_Electronic_Pte_Ltd_PO55903_delivery_order.pdf
File Size,2.0 MB
Processing Date,1/15/2024, 10:30:00 AM
Number of Pages,2 pages
,Extracted Data,
Supplier Name,WAGO Electronic Pte Ltd
PO Number,PO55903
Project Number,PRJ-2024-001
Date,15/01/2024
Delivery Date,20/01/2024
,Items Delivered,
Total Items Found,3 items
,Item 1,Terminal Block 2.5mm
Item 2,Disconnect Switch 32A
Item 3,Test Point Connector
```

**Status Codes:**
- `200` - CSV generated successfully
- `404` - Document not found
- `500` - Generation error

---

#### DELETE /api/documents/:id

Deletes a document and all associated data.

**Parameters:**
- `id` (string, required) - Document ID

**Response:**
```json
{
  "message": "Document deleted successfully"
}
```

**Status Codes:**
- `200` - Document deleted successfully
- `404` - Document not found
- `500` - Deletion error

---

## Client API Functions

### PR Generator Functions

#### processBOMFile()

Processes uploaded BOM file and extracts supplier groupings.

**Signature:**
```typescript
const processBOMFile = async (): Promise<void>
```

**Process:**
1. Reads file content using XLSX library
2. Finds valid BOM sheets with required columns
3. Extracts items grouped by supplier
4. Updates component state with processed data

**Required Columns:**
- `Maker` or `Supplier` - Supplier name
- `Model / Part No.` - Part number
- `Description` - Item description
- `Qty` - Quantity
- `Symbol` - Reference symbol
- `Remarks` - Additional notes

**State Updates:**
- `processedData` - Parsed BOM data
- `currentStep` - Advances to step 2

---

#### generatePurchaseRequisitions()

Creates purchase requisitions grouped by supplier.

**Signature:**
```typescript
const generatePurchaseRequisitions = async (): Promise<void>
```

**Process:**
1. Groups items by supplier from processed data
2. Creates PR objects with unique IDs
3. Calculates totals and item counts
4. Saves to database (if available)
5. Updates component state

**Generated PR Structure:**
```typescript
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
```

---

#### downloadPRPDF()

Generates PDF purchase requisition using template.

**Signature:**
```typescript
const downloadPRPDF = async (pr: PurchaseRequisition): Promise<void>
```

**Process:**
1. Loads PDF template from `/PR Export Template.pdf`
2. Fills in supplier, date, and PR number
3. Adds items with proper formatting
4. Handles multi-page documents
5. Downloads generated PDF

**Template Fields:**
- Vendor name
- PR Date
- PR Number
- Item details (description, maker, part number, quantity, unit price)
- Total amount

---

### Document Assistant Functions

#### processDocuments()

Processes multiple documents with progress tracking.

**Signature:**
```typescript
const processDocuments = async (): Promise<void>
```

**Process:**
1. Iterates through selected files
2. For PDFs: Uses client-side PDF.js + Tesseract
3. For images: Sends to server for processing
4. Updates progress indicators
5. Stores results in component state

**Progress Tracking:**
- Overall progress percentage
- Current processing stage
- Estimated time remaining
- Page-by-page progress for PDFs

---

#### processPDFWithTesseract()

Extracts text from PDF using client-side processing.

**Signature:**
```typescript
const processPDFWithTesseract = async (file: File): Promise<string>
```

**Process:**
1. Loads PDF using PDF.js
2. Renders each page to canvas
3. Processes canvas with Tesseract OCR
4. Combines text from all pages
5. Returns combined text with page separators

**Returns:**
```typescript
string // Combined text from all pages with "--- Page N ---" separators
```

---

#### filterDocuments()

Filters documents based on search criteria.

**Signature:**
```typescript
const filterDocuments = (): void
```

**Search Filters:**
- `all` - Search all fields
- `supplier` - Search supplier names
- `poNumber` - Search PO numbers
- `projectNumber` - Search project numbers
- `jobNumber` - Search job numbers
- `doNumber` - Search DO numbers
- `filename` - Search file names

**Search Logic:**
- Case-insensitive matching
- Partial string matching
- Searches both original and extracted data

---

### Report Builder Functions

#### processCurrentFile()

Processes ERP file and maps to template format.

**Signature:**
```typescript
const processCurrentFile = async (): Promise<void>
```

**Process:**
1. Reads file content (CSV or Excel)
2. Parses headers and data rows
3. Maps ERP columns to template format
4. Generates enhanced report data
5. Updates component state

**ERP Column Mapping:**
- Purchase Order Number → P.O Number
- Order Date → PO Issued Date
- Name → Vendor
- Item Number → Item No
- Item Description → Item Description
- Quantity Ordered → Order Qty
- Unit of Measure → Unit
- Unit Cost → Unit Price
- Extended Cost → Total Price

---

#### handleDownloadEnhancedReport()

Generates and downloads enhanced CSV report.

**Signature:**
```typescript
const handleDownloadEnhancedReport = (): void
```

**Process:**
1. Maps processed data to template headers
2. Generates CSV content with proper formatting
3. Creates downloadable file
4. Triggers browser download

**Template Headers:**
```typescript
const headers = [
  "S/N", "Work Order Number", "Client", "Vendor", "P.O Number",
  "PO Issued Date", "P.R Number", "PR Issued Date", "PR Prepared by",
  "Item No", "Item Description", "Order Qty", "Unit", "Unit Price",
  "Total Price", "DO Number", "Qty Received", "Qty Outstanding",
  "Vendor Acknowledgement", "Required Delivery Date",
  "Vendor Est Delivery Date (ETA)", "Actual Receiving Date",
  "Status update/Comments"
];
```

---

## Database API

### Database Operations

#### initDatabase()

Initializes SQLite database with tables and indexes.

**Signature:**
```typescript
const initDatabase = async (): Promise<Database.Database>
```

**Process:**
1. Creates database connection
2. Enables foreign key constraints
3. Creates tables if they don't exist
4. Creates indexes for performance
5. Returns database instance

**Tables Created:**
- `documents` - Main document records
- `document_items` - Extracted items
- `document_additional_data` - Extended data fields

---

#### saveDocument()

Saves document with extracted data using transactions.

**Signature:**
```typescript
const saveDocument = (documentData: any): string
```

**Process:**
1. Begins database transaction
2. Inserts main document record
3. Inserts document items (if any)
4. Inserts additional data (if any)
5. Commits transaction
6. Returns document ID

**Transaction Safety:**
- All operations in single transaction
- Rollback on any failure
- Foreign key constraints enforced

---

#### getAllDocuments()

Retrieves all documents with complete data.

**Signature:**
```typescript
const getAllDocuments = (): Document[]
```

**Process:**
1. Joins all related tables
2. Groups items by document ID
3. Formats data for client consumption
4. Orders by creation date (newest first)

**Returns:**
```typescript
interface Document {
  id: string;
  originalName: string;
  renamedName: string;
  type: string;
  fileSize: number;
  status: string;
  supplier: string;
  poNumber: string;
  projectNumber: string;
  date: string;
  extractedData: {
    supplier: string;
    poNumber: string;
    projectNumber: string;
    date: string;
    deliveryDate?: string;
    items: string[];
    pageCount: number;
    // ... additional fields
  };
  uploadTime: string;
}
```

---

#### getDocumentById()

Retrieves specific document by ID.

**Signature:**
```typescript
const getDocumentById = (id: string): Document | null
```

**Process:**
1. Queries database for document ID
2. Joins related tables
3. Formats data for client
4. Returns document or null if not found

---

#### deleteDocument()

Deletes document and all associated data.

**Signature:**
```typescript
const deleteDocument = (id: string): boolean
```

**Process:**
1. Deletes from main documents table
2. Cascades to related tables (items, additional data)
3. Returns true if deletion successful
4. Uses foreign key constraints for data integrity

---

## Component APIs

### ThemeProvider

#### useTheme()

Hook for accessing theme context.

**Signature:**
```typescript
const useTheme = (): ThemeContextType
```

**Returns:**
```typescript
interface ThemeContextType {
  theme: Theme;           // 'light' | 'dark'
  toggleTheme: () => void; // Toggle between themes
}
```

**Usage:**
```typescript
const { theme, toggleTheme } = useTheme();
```

**Features:**
- Persists theme in localStorage
- Detects system preference
- Applies theme to document root

---

### ThemeToggle

Theme switching button component.

**Props:**
```typescript
interface ThemeToggleProps {
  // No props required
}
```

**Features:**
- Automatic icon switching (Sun/Moon)
- Accessible with aria-label
- Ghost button variant
- 9x9 size with no padding

---

## Hook APIs

### useIsMobile

Detects mobile device screen size.

**Signature:**
```typescript
const useIsMobile = (): boolean
```

**Returns:**
- `true` if screen width < 768px
- `false` if screen width >= 768px
- Updates on window resize

**Usage:**
```typescript
const isMobile = useIsMobile();

if (isMobile) {
  // Mobile-specific logic
}
```

**Features:**
- Responsive to window resize
- Uses matchMedia API
- 768px breakpoint

---

### useToast

Toast notification system.

**Signature:**
```typescript
const useToast = (): {
  toasts: ToasterToast[];
  toast: (props: Toast) => ToastReturn;
  dismiss: (toastId?: string) => void;
}
```

**Toast Interface:**
```typescript
interface Toast {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
}
```

**Toast Return:**
```typescript
interface ToastReturn {
  id: string;
  dismiss: () => void;
  update: (props: ToasterToast) => void;
}
```

**Usage:**
```typescript
const { toast } = useToast();

// Show toast
const { id, dismiss, update } = toast({
  title: "Success",
  description: "File uploaded successfully"
});

// Update toast
update({
  title: "Updated",
  description: "New message"
});

// Dismiss toast
dismiss();
```

**Features:**
- Toast limit: 1
- Auto-remove delay: 1,000,000ms
- Global state management
- Action support

---

## Utility Functions

### cn()

Class name utility for conditional styling.

**Signature:**
```typescript
const cn = (...inputs: ClassValue[]): string
```

**Parameters:**
- `inputs` - Array of class values (strings, objects, arrays)

**Returns:**
- Merged and deduplicated class string

**Usage:**
```typescript
import { cn } from '@/lib/utils';

// Basic usage
const className = cn('base-class', 'conditional-class');

// Conditional classes
const className = cn(
  'base-class',
  condition && 'conditional-class',
  'another-class'
);

// Object syntax
const className = cn({
  'base-class': true,
  'conditional-class': condition,
  'disabled-class': isDisabled
});
```

**Features:**
- Combines clsx and tailwind-merge
- Handles Tailwind class conflicts
- Supports all clsx input types

---

## Type Definitions

### Core Types

#### Document
```typescript
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
```

#### BOMItem
```typescript
interface BOMItem {
  partNumber: string;
  description: string;
  quantity: number;
  supplier: string;
  symbol?: string;
  drawingNumber?: string;
  requestedDate?: string;
  remarks?: string;
  unitPrice?: number;
  totalPrice?: number;
  rowIndex: number;
  sheetName?: string;
}
```

#### PurchaseRequisition
```typescript
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
```

### API Response Types

#### DemoResponse
```typescript
interface DemoResponse {
  message: string;
}
```

#### ProcessingResult
```typescript
interface ProcessingResult {
  id: string;
  originalName: string;
  renamedName: string;
  type: string;
  fileSize: number;
  status: "Processed";
  supplier: string;
  poNumber: string;
  projectNumber: string;
  jobNumber: string;
  doNumber: string;
  date: string;
  extractedData: ExtractedData;
  filePath: string | null;
}
```

#### ExtractedData
```typescript
interface ExtractedData {
  supplier: string;
  poNumber: string;
  projectNumber: string;
  jobNumber: string;
  doNumber: string;
  date: string;
  deliveryDate?: string;
  items: string[];
  pageCount: number;
  confidence?: number;
  documentType?: string;
  currency?: string;
  totalAmount?: string;
  // ... additional fields
}
```

---

## Error Codes

### HTTP Status Codes

#### 200 - Success
- Request processed successfully
- Data returned as expected

#### 400 - Bad Request
- Invalid file format
- Missing required parameters
- File size exceeds limit
- Malformed request data

#### 404 - Not Found
- Document ID not found
- Resource not available
- Endpoint not found

#### 500 - Internal Server Error
- Database connection error
- OCR processing failure
- File system error
- Unexpected server error

### Error Response Format

```typescript
interface ErrorResponse {
  error: string;           // Error message
  details?: string;        // Additional details
  timestamp: string;       // ISO timestamp
  code?: string;          // Error code (optional)
}
```

### Common Error Messages

#### File Upload Errors
- `"Invalid file format. Please upload Excel or CSV files."`
- `"File size must be less than 10MB"`
- `"No file uploaded"`
- `"Unsupported file type"`

#### Processing Errors
- `"Failed to process document"`
- `"OCR engine not available"`
- `"No text could be extracted from the image"`
- `"Database connection failed"`

#### Database Errors
- `"Document not found"`
- `"Failed to save document"`
- `"Database operation failed"`

### Error Handling Best Practices

#### Client-Side
```typescript
try {
  const result = await processDocument(file);
  // Handle success
} catch (error) {
  if (error.message.includes('file size')) {
    setError('File is too large. Please choose a smaller file.');
  } else if (error.message.includes('format')) {
    setError('Invalid file format. Please upload a supported file type.');
  } else {
    setError('An unexpected error occurred. Please try again.');
  }
}
```

#### Server-Side
```typescript
try {
  // Process request
  const result = await processDocument(req.file);
  res.json(result);
} catch (error) {
  console.error('Processing error:', error);
  res.status(500).json({
    error: 'Failed to process document',
    details: error.message,
    timestamp: new Date().toISOString()
  });
}
```

---

This API reference provides comprehensive documentation for all public APIs, functions, and components in the CMR Procurement System. Use this as a quick reference for implementation details, parameter specifications, and error handling.