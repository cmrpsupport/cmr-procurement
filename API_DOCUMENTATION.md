# CMR Procurement System - API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Client-Side APIs](#client-side-apis)
4. [Server-Side APIs](#server-side-apis)
5. [Shared APIs](#shared-apis)
6. [Database APIs](#database-apis)
7. [Component Documentation](#component-documentation)
8. [Usage Examples](#usage-examples)
9. [Error Handling](#error-handling)
10. [Deployment](#deployment)

## Overview

The CMR Procurement System is a full-stack application built with React, TypeScript, Express.js, and SQLite. It provides three main modules:

- **PR Generator**: Upload BOM files and generate purchase requisitions by supplier
- **Document Assistant**: Scan documents and extract data with AI processing
- **Report Builder**: Complete incomplete reports by merging data from ERP systems

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client (React)│    │  Server (Express)│    │  Database (SQLite)│
│                 │    │                 │    │                 │
│ • Pages         │◄──►│ • Routes        │◄──►│ • Documents     │
│ • Components    │    │ • Services      │    │ • Items         │
│ • Hooks         │    │ • Middleware    │    │ • Additional    │
│ • Utils         │    │ • AI Processing │    │   Data          │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Client-Side APIs

### Pages

#### Index Page (`/client/pages/Index.tsx`)

The main landing page that provides navigation to all modules.

**Props**: None

**Features**:
- Module navigation cards
- Header with logo and theme toggle
- Responsive design

**Usage**:
```tsx
import Index from './pages/Index';

// Rendered automatically by React Router
<Route path="/" element={<Index />} />
```

#### PR Generator (`/client/pages/PRGenerator.tsx`)

Handles Bill of Materials (BOM) file processing and purchase requisition generation.

**Key Functions**:

```tsx
// File processing
const processBOMFile = async () => {
  // Processes uploaded BOM files (Excel/CSV)
  // Returns processed data with supplier groupings
}

// Purchase requisition generation
const generatePurchaseRequisitions = async () => {
  // Creates purchase requisitions grouped by supplier
  // Returns array of PR objects
}

// PDF generation
const downloadPRPDF = async (pr: PurchaseRequisition) => {
  // Generates PDF using pdf-lib
  // Uses template from /PR Export Template.pdf
}
```

**State Management**:
- `selectedFile`: Currently selected BOM file
- `processedData`: Parsed BOM data
- `purchaseRequisitions`: Generated PRs
- `currentStep`: Current workflow step (1-4)

**File Support**:
- Excel files: `.xlsx`, `.xls`, `.xlsb`
- CSV files: `.csv`
- Maximum file size: 10MB

#### Document Assistant (`/client/pages/DocumentAssistant.tsx`)

AI-powered document processing for delivery orders and invoices.

**Key Functions**:

```tsx
// Multi-file processing
const processDocuments = async () => {
  // Processes multiple documents simultaneously
  // Uses PDF.js + Tesseract for OCR
  // Returns array of processed documents
}

// PDF processing with progress tracking
const processPDFWithTesseract = async (file: File): Promise<string> => {
  // Extracts text from PDF using client-side processing
  // Returns combined text from all pages
}

// Document search and filtering
const filterDocuments = () => {
  // Filters documents based on search query and criteria
  // Supports search by supplier, PO number, project, etc.
}
```

**Supported File Types**:
- Images: `.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`
- PDFs: `.pdf`
- Maximum file size: 5MB per file

**Extracted Data Fields**:
- Supplier name
- PO number
- Project number
- Job number
- DO number
- Delivery date
- Items list
- Contact information

#### Report Builder (`/client/pages/ReportBuilder.tsx`)

ERP report enhancement and formatting.

**Key Functions**:

```tsx
// File processing
const processCurrentFile = async () => {
  // Processes ERP files (CSV/Excel)
  // Maps data to preferred template format
}

// Report generation
const handleDownloadEnhancedReport = () => {
  // Generates enhanced CSV report
  // Uses intelligent field mapping
}
```

**Supported File Types**:
- CSV files: `.csv`
- Excel files: `.xlsx`, `.xls`

### Components

#### ThemeProvider (`/client/components/ThemeProvider.tsx`)

Provides theme context for light/dark mode switching.

**API**:

```tsx
interface ThemeContextType {
  theme: Theme;           // 'light' | 'dark'
  toggleTheme: () => void; // Toggle between themes
}

// Usage
const { theme, toggleTheme } = useTheme();
```

#### ThemeToggle (`/client/components/ThemeToggle.tsx`)

Theme switching button component.

**Props**: None

**Features**:
- Automatic icon switching (Sun/Moon)
- Accessible button with aria-label
- Ghost variant styling

### Hooks

#### useIsMobile (`/client/hooks/use-mobile.tsx`)

Detects mobile device screen size.

**API**:

```tsx
const useIsMobile = (): boolean => {
  // Returns true if screen width < 768px
  // Updates on window resize
}

// Usage
const isMobile = useIsMobile();
```

#### useToast (`/client/hooks/use-toast.ts`)

Toast notification system.

**API**:

```tsx
interface Toast {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
}

const toast = (props: Toast) => {
  // Shows toast notification
  // Returns { id, dismiss, update }
}

// Usage
const { toast } = useToast();
toast({
  title: "Success",
  description: "File uploaded successfully"
});
```

### Utilities

#### cn (`/client/lib/utils.ts`)

Class name utility for conditional styling.

**API**:

```tsx
const cn = (...inputs: ClassValue[]): string => {
  // Combines and merges Tailwind classes
  // Uses clsx and tailwind-merge
}

// Usage
const className = cn(
  "base-class",
  condition && "conditional-class",
  "another-class"
);
```

## Server-Side APIs

### Main Server (`/server/index.ts`)

Express.js server with comprehensive API endpoints.

**Key Endpoints**:

#### Health Check
```http
GET /health
```
Returns server status and timestamp.

#### Demo Endpoint
```http
GET /api/demo
```
Returns demo message for testing.

#### Document Processing
```http
POST /api/process-document
Content-Type: multipart/form-data

FormData:
- document: File (required)
- extractedText: string (optional, for PDFs)
- pageCount: number (optional, for PDFs)
```

**Response**:
```json
{
  "id": "string",
  "originalName": "string",
  "renamedName": "string",
  "type": "string",
  "fileSize": "number",
  "status": "Processed",
  "supplier": "string",
  "poNumber": "string",
  "projectNumber": "string",
  "jobNumber": "string",
  "doNumber": "string",
  "date": "string",
  "extractedData": {
    "supplier": "string",
    "poNumber": "string",
    "projectNumber": "string",
    "jobNumber": "string",
    "doNumber": "string",
    "date": "string",
    "deliveryDate": "string",
    "items": ["string"],
    "pageCount": "number",
    "confidence": "number"
  }
}
```

#### Multiple Document Processing
```http
POST /api/process-documents
Content-Type: multipart/form-data

FormData:
- documents: File[] (up to 10 files)
```

#### Document Management
```http
GET /api/documents
```
Returns all processed documents.

```http
GET /api/documents/:id
```
Returns specific document by ID.

```http
GET /api/documents/:id/download
```
Downloads document data as CSV.

```http
DELETE /api/documents/:id
```
Deletes document and associated data.

### Document Processing (`/server/routes/document-processing.ts`)

Advanced document processing with AI-powered text extraction.

**Key Functions**:

#### Text Extraction
```typescript
const extractDataFromText = (text: string) => {
  // Extracts structured data from OCR text
  // Uses comprehensive regex patterns
  // Returns structured document data
}
```

**Extraction Patterns**:
- Supplier names with company suffixes
- PO numbers in various formats
- Project and job numbers
- Delivery order numbers
- Dates in multiple formats
- Item descriptions and quantities

#### OCR Processing
```typescript
const processImageWithTesseract = async (filePath: string, fileName: string) => {
  // Processes images with Tesseract OCR
  // Returns extracted text and confidence scores
}
```

#### Multi-page PDF Processing
```typescript
const splitMultiPagePDF = (fullText: string, originalFileName: string, fileSize: number, totalPages: number) => {
  // Splits multi-page PDFs into separate documents
  // Detects delivery orders and invoices
  // Returns array of document objects
}
```

### Database (`/server/database.ts`)

SQLite database operations with comprehensive document storage.

**Key Functions**:

#### Database Initialization
```typescript
const initDatabase = async () => {
  // Initializes SQLite database
  // Creates tables and indexes
  // Returns database instance
}
```

#### Document Operations
```typescript
const saveDocument = (documentData: any) => {
  // Saves document with extracted data
  // Handles items and additional data
  // Uses transactions for data integrity
}

const getAllDocuments = () => {
  // Retrieves all documents with full data
  // Joins items and additional data tables
  // Returns formatted document objects
}

const getDocumentById = (id: string) => {
  // Retrieves specific document by ID
  // Returns complete document data
}

const deleteDocument = (id: string) => {
  // Deletes document and all associated data
  // Uses foreign key constraints
}
```

**Database Schema**:

```sql
-- Main documents table
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  renamed_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'Processed',
  supplier TEXT,
  po_number TEXT,
  project_number TEXT,
  date TEXT,
  delivery_date TEXT,
  total_amount TEXT,
  page_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Document items table
CREATE TABLE document_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  item_description TEXT NOT NULL,
  item_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);

-- Additional document data table
CREATE TABLE document_additional_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  delivery_number TEXT,
  order_number TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  document_number TEXT,
  delivery_terms TEXT,
  payment_terms TEXT,
  currency TEXT DEFAULT 'S$',
  total_quantity TEXT,
  your_reference TEXT,
  rc_number TEXT,
  gst_number TEXT,
  company_reg_no TEXT,
  fax TEXT,
  website TEXT,
  contact_person TEXT,
  shipping_method TEXT,
  special_instructions TEXT,
  discount TEXT,
  subtotal TEXT,
  tax_amount TEXT,
  document_type TEXT,
  extracted_numbers TEXT,
  extracted_codes TEXT,
  all_dates_found TEXT,
  all_amounts_found TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);
```

## Shared APIs

### API Types (`/shared/api.ts`)

Shared TypeScript interfaces between client and server.

**Interfaces**:

```typescript
interface DemoResponse {
  message: string;
}
```

## Usage Examples

### Processing a BOM File

```typescript
// Client-side BOM processing
const handleBOMUpload = async (file: File) => {
  try {
    // Read file content
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    
    // Process sheets
    const validSheets = findValidBOMSheets(workbook);
    const processedData = processBOMSheets(validSheets);
    
    // Generate purchase requisitions
    const purchaseRequisitions = generatePRs(processedData);
    
    return purchaseRequisitions;
  } catch (error) {
    console.error('BOM processing failed:', error);
    throw error;
  }
};
```

### Document Processing with Progress

```typescript
// Client-side document processing with progress tracking
const processDocumentWithProgress = async (file: File) => {
  const startTime = Date.now();
  
  try {
    if (file.type === 'application/pdf') {
      // Use PDF.js + Tesseract
      const extractedText = await processPDFWithTesseract(file);
      
      // Send to server for data extraction
      const formData = new FormData();
      formData.append('document', file);
      formData.append('extractedText', extractedText);
      formData.append('pageCount', pageCount.toString());
      
      const response = await fetch('/api/process-document', {
        method: 'POST',
        body: formData
      });
      
      return await response.json();
    } else {
      // Direct server processing for images
      const formData = new FormData();
      formData.append('document', file);
      
      const response = await fetch('/api/process-document', {
        method: 'POST',
        body: formData
      });
      
      return await response.json();
    }
  } catch (error) {
    console.error('Document processing failed:', error);
    throw error;
  }
};
```

### Database Operations

```typescript
// Server-side document saving
const saveProcessedDocument = async (documentData: any) => {
  try {
    const db = await getDatabase();
    
    // Begin transaction
    const transaction = db.transaction((data: any) => {
      // Insert main document
      const insertDocument = db.prepare(`
        INSERT INTO documents (
          id, original_name, renamed_name, file_type, file_size,
          status, supplier, po_number, project_number, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertDocument.run(
        data.id,
        data.originalName,
        data.renamedName,
        data.type,
        data.fileSize,
        data.status,
        data.supplier,
        data.poNumber,
        data.projectNumber,
        data.date
      );
      
      // Insert items if they exist
      if (data.extractedData?.items?.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO document_items (document_id, item_description, item_order)
          VALUES (?, ?, ?)
        `);
        
        data.extractedData.items.forEach((item: string, index: number) => {
          insertItem.run(data.id, item, index);
        });
      }
    });
    
    transaction(documentData);
    return documentData.id;
  } catch (error) {
    console.error('Database save failed:', error);
    throw error;
  }
};
```

## Error Handling

### Client-Side Error Handling

```typescript
// File upload error handling
const handleFileUpload = async (file: File) => {
  try {
    // Validate file type
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'];
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Invalid file format. Please upload Excel or CSV files.');
    }
    
    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size must be less than 10MB');
    }
    
    // Process file
    const result = await processFile(file);
    return result;
  } catch (error) {
    console.error('File upload failed:', error);
    setUploadError(error.message);
    throw error;
  }
};
```

### Server-Side Error Handling

```typescript
// API endpoint error handling
export const processDocument: RequestHandler = async (req, res) => {
  try {
    upload.single("document")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ 
          error: err.message,
          details: "File upload failed"
        });
      }

      if (!req.file) {
        return res.status(400).json({ 
          error: "No file uploaded",
          details: "req.file is missing"
        });
      }

      try {
        // Process document
        const result = await processDocumentFile(req.file);
        res.json(result);
      } catch (processingError) {
        console.error('Processing error:', processingError);
        res.status(500).json({ 
          error: "Failed to process document", 
          details: processingError.message
        });
      }
    });
  } catch (error) {
    console.error('Endpoint error:', error);
    res.status(500).json({ 
      error: "Internal server error", 
      details: error.message
    });
  }
};
```

## Deployment

### Environment Variables

```bash
# Server configuration
NODE_ENV=production
PORT=3000

# Database configuration (optional)
SQLITE_AI_API_KEY=your_api_key
SQLITE_AI_PROJECT_ID=your_project_id

# File upload limits
MAX_FILE_SIZE=10485760  # 10MB
UPLOAD_DIR=./uploads
```

### Build Commands

```bash
# Install dependencies
npm install

# Build client
npm run build:client

# Build server
npm run build:server

# Start production server
npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY public/ ./public/

EXPOSE 3000

CMD ["npm", "start"]
```

## Performance Considerations

### Client-Side Optimization

- **Lazy Loading**: Components are loaded on demand
- **File Processing**: Large files are processed in chunks
- **Progress Tracking**: Real-time progress updates for long operations
- **Error Boundaries**: Graceful error handling and recovery

### Server-Side Optimization

- **Database Indexing**: Optimized queries with proper indexes
- **File Cleanup**: Automatic cleanup of uploaded files after processing
- **Transaction Management**: Database operations use transactions for consistency
- **Memory Management**: Proper cleanup of OCR workers and resources

### Scalability

- **Stateless Design**: Server endpoints are stateless for horizontal scaling
- **Database Connection Pooling**: Efficient database connection management
- **File Storage**: Configurable file storage (local or cloud)
- **Caching**: Optional caching layer for frequently accessed data

## Security Considerations

### File Upload Security

- **File Type Validation**: Strict file type checking
- **File Size Limits**: Configurable size limits
- **Virus Scanning**: Optional virus scanning integration
- **Secure File Storage**: Files are stored securely and cleaned up

### API Security

- **Input Validation**: All inputs are validated and sanitized
- **Error Handling**: Secure error messages without sensitive information
- **Rate Limiting**: Optional rate limiting for API endpoints
- **CORS Configuration**: Proper CORS setup for cross-origin requests

## Monitoring and Logging

### Client-Side Logging

```typescript
// Console logging for debugging
console.log('Processing file:', file.name);
console.log('Extracted data:', extractedData);
console.error('Processing failed:', error);
```

### Server-Side Logging

```typescript
// Structured logging
console.log('Document processing started:', {
  fileName: req.file.originalname,
  fileSize: req.file.size,
  timestamp: new Date().toISOString()
});

console.error('Processing error:', {
  error: error.message,
  stack: error.stack,
  timestamp: new Date().toISOString()
});
```

## Testing

### Unit Tests

```typescript
// Example test for utility function
import { cn } from '@/lib/utils';

describe('cn utility', () => {
  it('should merge class names correctly', () => {
    const result = cn('base-class', 'conditional-class');
    expect(result).toBe('base-class conditional-class');
  });
});
```

### Integration Tests

```typescript
// Example API test
describe('Document Processing API', () => {
  it('should process document successfully', async () => {
    const formData = new FormData();
    formData.append('document', testFile);
    
    const response = await request(app)
      .post('/api/process-document')
      .attach('document', testFile);
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('extractedData');
  });
});
```

## Contributing

### Code Style

- **TypeScript**: Strict type checking enabled
- **ESLint**: Code linting with recommended rules
- **Prettier**: Code formatting
- **Husky**: Pre-commit hooks for quality checks

### Development Workflow

1. **Feature Branch**: Create feature branch from main
2. **Development**: Implement feature with tests
3. **Testing**: Run unit and integration tests
4. **Code Review**: Submit pull request for review
5. **Merge**: Merge to main after approval

### Documentation Updates

- Update API documentation for new endpoints
- Add usage examples for new features
- Update component documentation
- Maintain changelog for releases

---

This documentation provides comprehensive coverage of all public APIs, functions, and components in the CMR Procurement System. For additional support or questions, please refer to the source code or contact the development team.