# CMR Procurement System - Usage Examples & Integration Guides

## Table of Contents

1. [Quick Start Guide](#quick-start-guide)
2. [Integration Examples](#integration-examples)
3. [API Integration Patterns](#api-integration-patterns)
4. [Component Integration](#component-integration)
5. [Database Integration](#database-integration)
6. [Error Handling Patterns](#error-handling-patterns)
7. [Performance Optimization](#performance-optimization)
8. [Testing Examples](#testing-examples)

## Quick Start Guide

### 1. Installation & Setup

```bash
# Clone the repository
git clone <repository-url>
cd cmr-procurement-system

# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm run build
npm start
```

### 2. Environment Configuration

Create `.env` file in the root directory:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration
DATABASE_PATH=./database.db

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# File Upload Configuration
MAX_FILE_SIZE=10485760
UPLOAD_DIR=./uploads

# AI Processing Configuration
TESSERACT_WORKER_PATH=./tesseract-worker
```

### 3. Basic Usage

```tsx
// App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Sonner } from 'sonner';

// Import pages
import Index from './pages/Index';
import PRGenerator from './pages/PRGenerator';
import DocumentAssistant from './pages/DocumentAssistant';
import ReportBuilder from './pages/ReportBuilder';

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/pr-generator" element={<PRGenerator />} />
          <Route path="/document-assistant" element={<DocumentAssistant />} />
          <Route path="/report-builder" element={<ReportBuilder />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
```

---

## Integration Examples

### 1. BOM File Processing Integration

```tsx
// components/BOMProcessor.tsx
import React, { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface BOMProcessorProps {
  onDataProcessed: (data: any) => void;
  onError: (error: string) => void;
}

const BOMProcessor: React.FC<BOMProcessorProps> = ({ onDataProcessed, onError }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const processBOMFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    
    try {
      // Validate file
      if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
        throw new Error('Invalid file format. Please upload Excel or CSV files.');
      }
      
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('File size must be less than 10MB');
      }
      
      // Read file
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      
      // Find valid BOM sheets
      const validSheets = findValidBOMSheets(workbook);
      
      if (validSheets.length === 0) {
        throw new Error('No valid BOM sheets found. Please check the file format.');
      }
      
      // Process sheets
      const processedData = processBOMSheets(validSheets);
      
      onDataProcessed(processedData);
      toast({
        title: "Success",
        description: `Processed ${validSheets.length} BOM sheet(s) successfully`
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onDataProcessed, onError, toast]);

  const findValidBOMSheets = (workbook: XLSX.WorkBook) => {
    const validSheets: XLSX.WorkSheet[] = [];
    
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (data.length > 1) {
        const headers = data[0] as string[];
        const hasRequiredColumns = headers.some(header => 
          header && header.toLowerCase().includes('supplier')
        );
        
        if (hasRequiredColumns) {
          validSheets.push(worksheet);
        }
      }
    });
    
    return validSheets;
  };

  const processBOMSheets = (sheets: XLSX.WorkSheet[]) => {
    const allItems: any[] = [];
    
    sheets.forEach(sheet => {
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const headers = data[0] as string[];
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i] as any[];
        if (row.length === 0) continue;
        
        const item: any = {};
        headers.forEach((header, index) => {
          if (header && row[index] !== undefined) {
            item[header] = row[index];
          }
        });
        
        if (item.supplier && item.supplier.trim()) {
          allItems.push(item);
        }
      }
    });
    
    // Group by supplier
    const supplierItems: { [key: string]: any[] } = {};
    allItems.forEach(item => {
      const supplier = item.supplier.trim();
      if (!supplierItems[supplier]) {
        supplierItems[supplier] = [];
      }
      supplierItems[supplier].push(item);
    });
    
    return {
      totalItems: allItems.length,
      totalSuppliers: Object.keys(supplierItems).length,
      supplierItems
    };
  };

  return {
    processBOMFile,
    isProcessing
  };
};

export default BOMProcessor;
```

### 2. Document Processing Integration

```tsx
// components/DocumentProcessor.tsx
import React, { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

interface DocumentProcessorProps {
  onDocumentProcessed: (document: any) => void;
  onError: (error: string) => void;
}

const DocumentProcessor: React.FC<DocumentProcessorProps> = ({ 
  onDocumentProcessed, 
  onError 
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const processPDFWithTesseract = useCallback(async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let extractedText = '';
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({
          canvasContext: context!,
          viewport: viewport
        }).promise;
        
        const imageData = canvas.toDataURL('image/png');
        
        const { data: { text } } = await Tesseract.recognize(
          imageData,
          'eng',
          {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                const pageProgress = (pageNum - 1 + m.progress) / pdf.numPages;
                setProgress(Math.round(pageProgress * 100));
              }
            }
          }
        );
        
        extractedText += text + '\n';
      }
      
      return extractedText;
    } catch (error) {
      throw new Error(`PDF processing failed: ${error}`);
    }
  }, []);

  const processDocument = useCallback(async (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    
    try {
      let extractedText = '';
      
      if (file.type === 'application/pdf') {
        extractedText = await processPDFWithTesseract(file);
      } else {
        // Process image with Tesseract
        const { data: { text } } = await Tesseract.recognize(
          file,
          'eng',
          {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                setProgress(Math.round(m.progress * 100));
              }
            }
          }
        );
        extractedText = text;
      }
      
      // Send to server for further processing
      const formData = new FormData();
      formData.append('document', file);
      formData.append('extractedText', extractedText);
      
      const response = await fetch('/api/process-document', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }
      
      const result = await response.json();
      onDocumentProcessed(result);
      
      toast({
        title: "Success",
        description: "Document processed successfully"
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [processPDFWithTesseract, onDocumentProcessed, onError, toast]);

  return {
    processDocument,
    isProcessing,
    progress
  };
};

export default DocumentProcessor;
```

### 3. Report Builder Integration

```tsx
// components/ReportBuilder.tsx
import React, { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface ReportBuilderProps {
  onReportGenerated: (report: any) => void;
  onError: (error: string) => void;
}

const ReportBuilder: React.FC<ReportBuilderProps> = ({ 
  onReportGenerated, 
  onError 
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const processERPFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    
    try {
      // Validate file
      if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
        throw new Error('Invalid file format. Please upload Excel or CSV files.');
      }
      
      // Read file content
      const content = await readFileContent(file);
      const parsedData = parseFileContent(content, file.name);
      
      // Generate enhanced report
      const enhancedReport = generateEnhancedReport(parsedData);
      
      onReportGenerated(enhancedReport);
      
      toast({
        title: "Success",
        description: "Report generated successfully"
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onReportGenerated, onError, toast]);

  const readFileContent = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        if (file.name.toLowerCase().endsWith('.xlsx')) {
          const binaryString = e.target?.result as string;
          const workbook = XLSX.read(binaryString, { type: 'binary' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const csvContent = XLSX.utils.sheet_to_csv(worksheet);
          resolve(csvContent);
        } else {
          resolve(e.target?.result as string);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsBinaryString(file);
    });
  };

  const parseFileContent = (content: string, fileName: string) => {
    const lines = content.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    const data = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const item: any = {};
      headers.forEach((header, index) => {
        item[header] = values[index] || '';
      });
      return item;
    });
    
    return {
      fileName,
      headers,
      data,
      totalRows: data.length
    };
  };

  const generateEnhancedReport = (parsedData: any) => {
    const headers = [
      "S/N", "Work Order Number", "Client", "Vendor", "P.O Number",
      "PO Issued Date", "P.R Number", "PR Issued Date", "PR Prepared by",
      "Item No", "Item Description", "Order Qty", "Unit", "Unit Price",
      "Total Price", "DO Number", "Qty Received", "Qty Outstanding"
    ];
    
    const enhancedData = parsedData.data.map((item: any, index: number) => {
      const row: string[] = [];
      
      headers.forEach((header: string) => {
        const headerLower = header.toLowerCase();
        let value = "";
        
        if (headerLower.includes('work order')) {
          value = item.workOrderNumber || `WO-${String(index + 1).padStart(3, '0')}`;
        } else if (headerLower === 'vendor') {
          value = item.vendor || "Vendor from ERP";
        } else if (headerLower.includes('p.o number')) {
          value = item.poNumber || "";
        } else if (headerLower.includes('item no')) {
          value = item.itemNo || "";
        } else if (headerLower.includes('description')) {
          value = item.description || "";
        } else if (headerLower.includes('order qty')) {
          value = item.orderQty || "";
        } else if (headerLower.includes('unit price')) {
          value = item.unitPrice || "";
        } else if (headerLower.includes('total price')) {
          value = item.totalPrice || "";
        }
        
        row.push(value);
      });
      
      return row;
    });
    
    return {
      originalData: parsedData,
      enhancedData,
      headers,
      totalRows: enhancedData.length
    };
  };

  return {
    processERPFile,
    isProcessing
  };
};

export default ReportBuilder;
```

---

## API Integration Patterns

### 1. RESTful API Client

```tsx
// services/apiClient.ts
class ApiClient {
  private baseURL: string;
  private defaultHeaders: HeadersInit;

  constructor(baseURL: string = '/api') {
    this.baseURL = baseURL;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const config: RequestInit = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      
      return await response.text() as unknown as T;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // GET request
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  // POST request
  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // POST with FormData
  async postFormData<T>(endpoint: string, formData: FormData): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
```

### 2. Document API Integration

```tsx
// services/documentService.ts
import { apiClient } from './apiClient';

export interface Document {
  id: string;
  originalName: string;
  renamedName: string;
  supplier: string;
  poNumber: string;
  projectNumber: string;
  jobNumber: string;
  doNumber: string;
  date: string;
  extractedData: {
    items: any[];
    additionalData: any;
  };
  createdAt: string;
}

export class DocumentService {
  // Process single document
  static async processDocument(file: File, extractedText?: string): Promise<Document> {
    const formData = new FormData();
    formData.append('document', file);
    
    if (extractedText) {
      formData.append('extractedText', extractedText);
    }
    
    return apiClient.postFormData<Document>('/process-document', formData);
  }

  // Process multiple documents
  static async processMultipleDocuments(files: File[]): Promise<Document[]> {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('documents', file);
    });
    
    return apiClient.postFormData<Document[]>('/process-documents', formData);
  }

  // Get all documents
  static async getAllDocuments(): Promise<Document[]> {
    return apiClient.get<Document[]>('/documents');
  }

  // Get document by ID
  static async getDocumentById(id: string): Promise<Document> {
    return apiClient.get<Document>(`/documents/${id}`);
  }

  // Download document CSV
  static async downloadDocumentCSV(id: string): Promise<Blob> {
    const response = await fetch(`/api/documents/${id}/csv`);
    if (!response.ok) {
      throw new Error('Failed to download CSV');
    }
    return response.blob();
  }

  // Delete document
  static async deleteDocument(id: string): Promise<void> {
    return apiClient.delete<void>(`/documents/${id}`);
  }
}
```

### 3. BOM Processing API Integration

```tsx
// services/bomService.ts
import { apiClient } from './apiClient';

export interface BOMItem {
  supplier: string;
  itemNo: string;
  description: string;
  orderQty: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface PurchaseRequisition {
  id: string;
  supplier: string;
  items: BOMItem[];
  totalItems: number;
  totalValue: number;
  status: 'Draft' | 'Approved' | 'Sent';
  createdAt: string;
  prNumber: string;
}

export class BOMService {
  // Upload BOM file
  static async uploadBOMFile(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('bomFile', file);
    
    return apiClient.postFormData('/bom/files', formData);
  }

  // Generate purchase requisitions
  static async generatePurchaseRequisitions(bomData: any): Promise<PurchaseRequisition[]> {
    return apiClient.post<PurchaseRequisition[]>('/purchase-requisitions', bomData);
  }

  // Get all purchase requisitions
  static async getAllPurchaseRequisitions(): Promise<PurchaseRequisition[]> {
    return apiClient.get<PurchaseRequisition[]>('/purchase-requisitions');
  }

  // Update purchase requisition
  static async updatePurchaseRequisition(id: string, data: Partial<PurchaseRequisition>): Promise<PurchaseRequisition> {
    return apiClient.put<PurchaseRequisition>(`/purchase-requisitions/${id}`, data);
  }

  // Delete purchase requisition
  static async deletePurchaseRequisition(id: string): Promise<void> {
    return apiClient.delete<void>(`/purchase-requisitions/${id}`);
  }
}
```

---

## Component Integration

### 1. Custom Hook Integration

```tsx
// hooks/useDocumentProcessing.ts
import { useState, useCallback } from 'react';
import { useToast } from './use-toast';
import { DocumentService } from '../services/documentService';

export const useDocumentProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedDocuments, setProcessedDocuments] = useState<any[]>([]);
  const { toast } = useToast();

  const processDocuments = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setProgress(0);
    
    try {
      const results: any[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(Math.round(((i + 1) / files.length) * 100));
        
        const result = await DocumentService.processDocument(file);
        results.push(result);
      }
      
      setProcessedDocuments(results);
      
      toast({
        title: "Success",
        description: `Processed ${results.length} document(s) successfully`
      });
      
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process documents",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [toast]);

  const clearResults = useCallback(() => {
    setProcessedDocuments([]);
  }, []);

  return {
    isProcessing,
    progress,
    processedDocuments,
    processDocuments,
    clearResults
  };
};
```

### 2. Context Provider Integration

```tsx
// contexts/AppContext.tsx
import React, { createContext, useContext, useReducer, ReactNode } from 'react';

interface AppState {
  theme: 'light' | 'dark';
  user: any;
  documents: any[];
  purchaseRequisitions: any[];
}

type AppAction = 
  | { type: 'SET_THEME'; payload: 'light' | 'dark' }
  | { type: 'SET_USER'; payload: any }
  | { type: 'ADD_DOCUMENT'; payload: any }
  | { type: 'ADD_PURCHASE_REQUISITION'; payload: any };

const initialState: AppState = {
  theme: 'light',
  user: null,
  documents: [],
  purchaseRequisitions: []
};

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'SET_USER':
      return { ...state, user: action.payload };
    case 'ADD_DOCUMENT':
      return { ...state, documents: [...state.documents, action.payload] };
    case 'ADD_PURCHASE_REQUISITION':
      return { ...state, purchaseRequisitions: [...state.purchaseRequisitions, action.payload] };
    default:
      return state;
  }
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};
```

---

## Database Integration

### 1. Database Service Integration

```tsx
// services/databaseService.ts
import { getDatabase } from '../server/database';

export class DatabaseService {
  // Document operations
  static async saveDocument(documentData: any): Promise<string> {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO documents (
        original_name, renamed_name, supplier, po_number, project_number,
        job_number, do_number, date, extracted_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      documentData.originalName,
      documentData.renamedName,
      documentData.supplier,
      documentData.poNumber,
      documentData.projectNumber,
      documentData.jobNumber,
      documentData.doNumber,
      documentData.date,
      JSON.stringify(documentData.extractedData),
      new Date().toISOString()
    );
    
    return result.lastInsertRowid.toString();
  }

  static async getAllDocuments(): Promise<any[]> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM documents ORDER BY created_at DESC');
    return stmt.all();
  }

  static async getDocumentById(id: string): Promise<any> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
    return stmt.get(id);
  }

  static async deleteDocument(id: string): Promise<void> {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM documents WHERE id = ?');
    stmt.run(id);
  }

  // Purchase requisition operations
  static async savePurchaseRequisition(prData: any): Promise<string> {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO purchase_requisitions (
        supplier, items, total_items, total_value, status, created_at, pr_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      prData.supplier,
      JSON.stringify(prData.items),
      prData.totalItems,
      prData.totalValue,
      prData.status,
      new Date().toISOString(),
      prData.prNumber
    );
    
    return result.lastInsertRowid.toString();
  }

  static async getAllPurchaseRequisitions(): Promise<any[]> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM purchase_requisitions ORDER BY created_at DESC');
    return stmt.all();
  }

  static async updatePurchaseRequisition(id: string, data: any): Promise<void> {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE purchase_requisitions 
      SET supplier = ?, items = ?, total_items = ?, total_value = ?, status = ?
      WHERE id = ?
    `);
    
    stmt.run(
      data.supplier,
      JSON.stringify(data.items),
      data.totalItems,
      data.totalValue,
      data.status,
      id
    );
  }
}
```

### 2. Database Migration

```tsx
// scripts/migrate.ts
import { getDatabase } from '../server/database';

export const runMigrations = () => {
  const db = getDatabase();
  
  // Create documents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      renamed_name TEXT NOT NULL,
      supplier TEXT,
      po_number TEXT,
      project_number TEXT,
      job_number TEXT,
      do_number TEXT,
      date TEXT,
      extracted_data TEXT,
      created_at TEXT NOT NULL
    )
  `);
  
  // Create document_items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      item_no TEXT,
      description TEXT,
      qty TEXT,
      unit TEXT,
      unit_price TEXT,
      total_price TEXT,
      FOREIGN KEY (document_id) REFERENCES documents (id)
    )
  `);
  
  // Create purchase_requisitions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT NOT NULL,
      items TEXT NOT NULL,
      total_items INTEGER NOT NULL,
      total_value REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      created_at TEXT NOT NULL,
      pr_number TEXT NOT NULL
    )
  `);
  
  console.log('Database migrations completed successfully');
};
```

---

## Error Handling Patterns

### 1. Global Error Handler

```tsx
// components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    
    // Log to external service
    this.logErrorToService(error, errorInfo);
  }

  private logErrorToService = (error: Error, errorInfo: ErrorInfo) => {
    // Implement logging to external service
    console.log('Logging error to service:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-boundary">
          <h2>Something went wrong.</h2>
          <details>
            <summary>Error details</summary>
            <pre>{this.state.error?.stack}</pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
```

### 2. API Error Handling

```tsx
// utils/errorHandler.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const handleApiError = (error: any): ApiError => {
  if (error instanceof ApiError) {
    return error;
  }
  
  if (error.response) {
    // Server responded with error status
    return new ApiError(
      error.response.data?.message || 'Server error occurred',
      error.response.status,
      error.response.data?.code
    );
  }
  
  if (error.request) {
    // Network error
    return new ApiError(
      'Network error - please check your connection',
      0,
      'NETWORK_ERROR'
    );
  }
  
  // Other error
  return new ApiError(
    error.message || 'An unexpected error occurred',
    0,
    'UNKNOWN_ERROR'
  );
};

export const getErrorMessage = (error: any): string => {
  const apiError = handleApiError(error);
  
  switch (apiError.code) {
    case 'NETWORK_ERROR':
      return 'Please check your internet connection and try again.';
    case 'VALIDATION_ERROR':
      return 'Please check your input and try again.';
    case 'AUTHENTICATION_ERROR':
      return 'Please log in and try again.';
    default:
      return apiError.message;
  }
};
```

---

## Performance Optimization

### 1. Lazy Loading

```tsx
// components/LazyComponents.tsx
import { lazy, Suspense } from 'react';

// Lazy load heavy components
const PRGenerator = lazy(() => import('../pages/PRGenerator'));
const DocumentAssistant = lazy(() => import('../pages/DocumentAssistant'));
const ReportBuilder = lazy(() => import('../pages/ReportBuilder'));

// Loading component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
  </div>
);

// Lazy component wrapper
export const LazyPRGenerator = () => (
  <Suspense fallback={<LoadingSpinner />}>
    <PRGenerator />
  </Suspense>
);

export const LazyDocumentAssistant = () => (
  <Suspense fallback={<LoadingSpinner />}>
    <DocumentAssistant />
  </Suspense>
);

export const LazyReportBuilder = () => (
  <Suspense fallback={<LoadingSpinner />}>
    <ReportBuilder />
  </Suspense>
);
```

### 2. Memoization

```tsx
// components/OptimizedComponent.tsx
import React, { memo, useMemo, useCallback } from 'react';

interface OptimizedComponentProps {
  data: any[];
  onItemClick: (item: any) => void;
}

const OptimizedComponent = memo<OptimizedComponentProps>(({ data, onItemClick }) => {
  // Memoize expensive calculations
  const processedData = useMemo(() => {
    return data.map(item => ({
      ...item,
      processedValue: item.value * 1.2
    }));
  }, [data]);

  // Memoize callbacks
  const handleItemClick = useCallback((item: any) => {
    onItemClick(item);
  }, [onItemClick]);

  return (
    <div>
      {processedData.map(item => (
        <div key={item.id} onClick={() => handleItemClick(item)}>
          {item.name}
        </div>
      ))}
    </div>
  );
});

OptimizedComponent.displayName = 'OptimizedComponent';

export default OptimizedComponent;
```

### 3. Virtual Scrolling

```tsx
// components/VirtualList.tsx
import React, { useState, useEffect, useRef } from 'react';

interface VirtualListProps {
  items: any[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: any, index: number) => React.ReactNode;
}

const VirtualList: React.FC<VirtualListProps> = ({
  items,
  itemHeight,
  containerHeight,
  renderItem
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.min(
    visibleStart + Math.ceil(containerHeight / itemHeight) + 1,
    items.length
  );

  const visibleItems = items.slice(visibleStart, visibleEnd);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      ref={containerRef}
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={handleScroll}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${visibleStart * itemHeight}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0
          }}
        >
          {visibleItems.map((item, index) => (
            <div key={visibleStart + index} style={{ height: itemHeight }}>
              {renderItem(item, visibleStart + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VirtualList;
```

---

## Testing Examples

### 1. Component Testing

```tsx
// __tests__/components/ThemeToggle.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../components/ThemeProvider';
import { ThemeToggle } from '../../components/ThemeToggle';

const renderWithTheme = (component: React.ReactElement) => {
  return render(
    <ThemeProvider>
      {component}
    </ThemeProvider>
  );
};

describe('ThemeToggle', () => {
  it('renders theme toggle button', () => {
    renderWithTheme(<ThemeToggle />);
    
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('toggles theme when clicked', () => {
    renderWithTheme(<ThemeToggle />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    // Check if theme changed (you'd need to implement theme testing)
    expect(document.documentElement).toHaveClass('dark');
  });

  it('has correct accessibility attributes', () => {
    renderWithTheme(<ThemeToggle />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Toggle theme');
  });
});
```

### 2. Hook Testing

```tsx
// __tests__/hooks/useIsMobile.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../../hooks/use-mobile';

describe('useIsMobile', () => {
  beforeEach(() => {
    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  it('returns false for desktop screen size', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true for mobile screen size', () => {
    // Mock mobile screen size
    window.matchMedia = jest.fn().mockImplementation(query => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
```

### 3. API Testing

```tsx
// __tests__/services/documentService.test.ts
import { DocumentService } from '../../services/documentService';

// Mock fetch
global.fetch = jest.fn();

describe('DocumentService', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  it('processes document successfully', async () => {
    const mockResponse = {
      id: '1',
      originalName: 'test.pdf',
      supplier: 'Test Supplier',
      poNumber: 'PO-123'
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

    const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
    const result = await DocumentService.processDocument(file);

    expect(fetch).toHaveBeenCalledWith('/api/process-document', {
      method: 'POST',
      body: expect.any(FormData)
    });

    expect(result).toEqual(mockResponse);
  });

  it('handles API errors', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error'
    });

    const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
    
    await expect(DocumentService.processDocument(file)).rejects.toThrow();
  });
});
```

---

This comprehensive usage examples and integration guide provides practical patterns for implementing the CMR Procurement System components and APIs in real-world applications. Use these examples as templates for your own implementations and adapt them to your specific requirements.