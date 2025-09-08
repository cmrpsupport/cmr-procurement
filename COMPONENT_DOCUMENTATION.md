# CMR Procurement System - Component Documentation

## Table of Contents

1. [Page Components](#page-components)
2. [UI Components](#ui-components)
3. [Custom Hooks](#custom-hooks)
4. [Utility Components](#utility-components)
5. [Usage Examples](#usage-examples)

## Page Components

### Index Page

**File:** `/client/pages/Index.tsx`

Main landing page with module navigation.

**Props:** None

**Features:**
- Module navigation cards
- Header with logo and theme toggle
- Responsive grid layout

**Usage:**
```tsx
import Index from './pages/Index';

// Rendered by React Router
<Route path="/" element={<Index />} />
```

**Module Configuration:**
```tsx
const modules = [
  {
    title: "PR Generator",
    description: "Upload BOM files and generate purchase requisitions by supplier",
    icon: FileText,
    route: "/pr-generator"
  },
  {
    title: "Document Assistant", 
    description: "Scan documents and extract data with AI processing",
    icon: ScanLine,
    route: "/document-assistant"
  },
  {
    title: "Report Builder",
    description: "Complete incomplete reports by merging data from ERP systems", 
    icon: BarChart3,
    route: "/report-builder"
  }
];
```

---

### PR Generator Page

**File:** `/client/pages/PRGenerator.tsx`

Handles BOM file processing and PR generation.

**Key State:**
```tsx
const [selectedFile, setSelectedFile] = useState<File | null>(null);
const [processedData, setProcessedData] = useState<any>(null);
const [purchaseRequisitions, setPurchaseRequisitions] = useState<PurchaseRequisition[]>([]);
const [currentStep, setCurrentStep] = useState(1);
```

**Workflow Steps:**
1. **Upload BOM** - File selection and validation
2. **Review Sorting** - Verify supplier assignments  
3. **Generate PRs** - Create purchase requisitions
4. **Finalize** - Review and approve

**File Processing:**
```tsx
const processBOMFile = async () => {
  const data = await selectedFile.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  
  // Find valid BOM sheets
  const validSheets = findValidBOMSheets(workbook);
  
  // Process and group by supplier
  const processedData = processBOMSheets(validSheets);
  setProcessedData(processedData);
  setCurrentStep(2);
};
```

**PDF Generation:**
```tsx
const downloadPRPDF = async (pr: PurchaseRequisition) => {
  // Load PDF template
  const templateBytes = await fetch('/PR Export Template.pdf').then(res => res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes);
  
  // Fill template fields
  const page = pdfDoc.getPages()[0];
  page.drawText(pr.supplier, { x: 120, y: 580, size: 10 });
  page.drawText(pr.prNumber, { x: 630, y: 580, size: 9 });
  
  // Add items to table
  // ... item rendering logic
  
  // Download PDF
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${pr.prNumber}_${pr.supplier}.pdf`;
  link.click();
};
```

---

### Document Assistant Page

**File:** `/client/pages/DocumentAssistant.tsx`

AI-powered document processing with progress tracking.

**Key State:**
```tsx
const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
const [processedDocuments, setProcessedDocuments] = useState<Document[]>([]);
const [processingProgress, setProcessingProgress] = useState<number>(0);
const [processingStage, setProcessingStage] = useState<string>("");
```

**Multi-file Processing:**
```tsx
const processDocuments = async () => {
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    setCurrentProcessingIndex(i + 1);
    
    if (file.type === "application/pdf") {
      // Client-side PDF processing
      const extractedText = await processPDFWithTesseract(file);
      const formData = new FormData();
      formData.append("document", file);
      formData.append("extractedText", extractedText);
      formData.append("pageCount", pageCount.toString());
      
      const response = await fetch("/api/process-document", {
        method: "POST",
        body: formData,
      });
      
      const result = await response.json();
      processedResults.push(result);
    } else {
      // Server-side image processing
      const formData = new FormData();
      formData.append("document", file);
      
      const response = await fetch("/api/process-document", {
        method: "POST",
        body: formData,
      });
      
      const result = await response.json();
      processedResults.push(result);
    }
  }
};
```

**Progress Tracking:**
```tsx
const updateProgress = (current: number, total: number, stage: string, startTime: number) => {
  const progress = Math.round((current / total) * 100);
  setProcessingProgress(progress);
  setProcessingStage(stage);
  
  // Calculate estimated time remaining
  const elapsed = Date.now() - startTime;
  const avgTimePerPage = elapsed / current;
  const remaining = (total - current) * avgTimePerPage;
  
  if (remaining > 60000) {
    setEstimatedTimeRemaining(`${Math.ceil(remaining / 60000)} min remaining`);
  } else {
    setEstimatedTimeRemaining(`${Math.ceil(remaining / 1000)} sec remaining`);
  }
};
```

**Document Search:**
```tsx
const filterDocuments = () => {
  let filtered = documentHistory;
  
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(doc => {
      switch (searchFilter) {
        case 'supplier':
          return doc.supplier.toLowerCase().includes(query);
        case 'poNumber':
          return doc.poNumber.toLowerCase().includes(query);
        case 'projectNumber':
          return doc.projectNumber.toLowerCase().includes(query);
        default:
          return Object.values(doc).some(value => 
            value && value.toString().toLowerCase().includes(query)
          );
      }
    });
  }
  
  setFilteredDocuments(filtered);
};
```

---

### Report Builder Page

**File:** `/client/pages/ReportBuilder.tsx`

ERP report enhancement and formatting.

**Key State:**
```tsx
const [erpFile, setErpFile] = useState<File | null>(null);
const [processedData, setProcessedData] = useState<any>(null);
const [showResults, setShowResults] = useState(false);
```

**File Processing:**
```tsx
const processCurrentFile = async () => {
  const content = await readFileContent(erpFile);
  const parsedData = parseFileContent(content, erpFile.name);
  
  setProcessedData(parsedData);
  setShowResults(true);
};

const readFileContent = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        // Excel processing
        const binaryString = e.target?.result as string;
        const workbook = XLSX.read(binaryString, { type: 'binary' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const csvContent = XLSX.utils.sheet_to_csv(worksheet);
        resolve(csvContent);
      } else {
        // CSV processing
        resolve(e.target?.result as string);
      }
    };
    
    reader.readAsBinaryString(file);
  });
};
```

**Data Mapping:**
```tsx
const mapDataToTemplate = (item: any, index: number) => {
  const headers = [
    "S/N", "Work Order Number", "Client", "Vendor", "P.O Number",
    "PO Issued Date", "P.R Number", "PR Issued Date", "PR Prepared by",
    "Item No", "Item Description", "Order Qty", "Unit", "Unit Price",
    "Total Price", "DO Number", "Qty Received", "Qty Outstanding"
  ];
  
  const row: string[] = [];
  
  headers.forEach((header: string) => {
    const headerLower = header.toLowerCase();
    let value = "";
    
    if (headerLower.includes('work order')) {
      value = item.mappedData.workOrderNumber || `WO-${String(index + 1).padStart(3, '0')}`;
    } else if (headerLower === 'vendor') {
      value = item.mappedData.vendor || "Vendor from ERP";
    } else if (headerLower.includes('p.o number')) {
      value = item.mappedData.poNumber;
    } else if (headerLower.includes('item no')) {
      value = item.mappedData.itemNo;
    } else if (headerLower.includes('description')) {
      value = item.mappedData.description;
    } else if (headerLower.includes('order qty')) {
      value = item.mappedData.orderQty;
    } else if (headerLower.includes('unit price')) {
      value = item.mappedData.unitPrice;
    } else if (headerLower.includes('total price')) {
      value = item.mappedData.totalPrice;
    }
    
    row.push(value || "");
  });
  
  return row;
};
```

---

## UI Components

### ThemeProvider

**File:** `/client/components/ThemeProvider.tsx`

Provides theme context for light/dark mode.

**Context Interface:**
```tsx
interface ThemeContextType {
  theme: Theme;           // 'light' | 'dark'
  toggleTheme: () => void; // Toggle between themes
}
```

**Usage:**
```tsx
import { ThemeProvider, useTheme } from './components/ThemeProvider';

// Wrap app
<ThemeProvider>
  <App />
</ThemeProvider>

// Use in components
const { theme, toggleTheme } = useTheme();
```

**Features:**
- Persists theme in localStorage
- Detects system preference
- Applies theme to document root
- Context-based state management

---

### ThemeToggle

**File:** `/client/components/ThemeToggle.tsx`

Theme switching button component.

**Props:** None

**Usage:**
```tsx
import { ThemeToggle } from './components/ThemeToggle';

<ThemeToggle />
```

**Features:**
- Automatic icon switching (Sun/Moon)
- Accessible with aria-label
- Ghost button variant
- 9x9 size with no padding

---

## Custom Hooks

### useIsMobile

**File:** `/client/hooks/use-mobile.tsx`

Detects mobile device screen size.

**API:**
```tsx
const useIsMobile = (): boolean
```

**Usage:**
```tsx
import { useIsMobile } from '@/hooks/use-mobile';

const MyComponent = () => {
  const isMobile = useIsMobile();
  
  return (
    <div className={cn(
      "grid",
      isMobile ? "grid-cols-1" : "grid-cols-3"
    )}>
      {/* Content */}
    </div>
  );
};
```

**Features:**
- 768px breakpoint
- Responsive to window resize
- Uses matchMedia API
- Returns boolean value

---

### useToast

**File:** `/client/hooks/use-toast.ts`

Toast notification system.

**API:**
```tsx
const useToast = (): {
  toasts: ToasterToast[];
  toast: (props: Toast) => ToastReturn;
  dismiss: (toastId?: string) => void;
}
```

**Usage:**
```tsx
import { useToast } from '@/hooks/use-toast';

const MyComponent = () => {
  const { toast } = useToast();
  
  const handleSuccess = () => {
    toast({
      title: "Success",
      description: "File uploaded successfully"
    });
  };
  
  const handleError = () => {
    toast({
      title: "Error", 
      description: "Upload failed",
      variant: "destructive"
    });
  };
  
  return (
    <div>
      <button onClick={handleSuccess}>Upload</button>
      <button onClick={handleError}>Test Error</button>
    </div>
  );
};
```

**Features:**
- Toast limit: 1
- Auto-remove delay: 1,000,000ms
- Global state management
- Action support
- Multiple variants

---

## Utility Components

### cn Utility

**File:** `/client/lib/utils.ts`

Class name utility for conditional styling.

**API:**
```tsx
const cn = (...inputs: ClassValue[]): string
```

**Usage:**
```tsx
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

// Array syntax
const className = cn([
  'base-class',
  condition ? 'conditional-class' : 'alternative-class'
]);
```

**Features:**
- Combines clsx and tailwind-merge
- Handles Tailwind class conflicts
- Supports all clsx input types
- Type-safe with TypeScript

---

## Usage Examples

### Complete BOM Processing Flow

```tsx
import { useState } from 'react';
import { processBOMFile, generatePurchaseRequisitions } from './PRGenerator';

const BOMProcessor = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processedData, setProcessedData] = useState<any>(null);
  const [purchaseRequisitions, setPurchaseRequisitions] = useState<PurchaseRequisition[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  
  const handleFileSelect = (file: File) => {
    // Validate file type
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid file format. Please upload Excel or CSV files.');
      return;
    }
    
    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }
    
    setSelectedFile(file);
  };
  
  const handleProcess = async () => {
    if (!selectedFile) return;
    
    try {
      // Process BOM file
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      
      // Find valid BOM sheets
      const validSheets = findValidBOMSheets(workbook);
      const processedData = processBOMSheets(validSheets);
      
      setProcessedData(processedData);
      setCurrentStep(2);
    } catch (error) {
      console.error('Processing failed:', error);
      alert('Failed to process BOM file. Please check the format.');
    }
  };
  
  const handleGeneratePRs = async () => {
    if (!processedData) return;
    
    try {
      // Generate purchase requisitions
      const prs = Object.entries(processedData.supplierItems).map(([supplier, items], index) => ({
        id: Date.now().toString() + index,
        supplier,
        items: items as BOMItem[],
        totalItems: (items as BOMItem[]).length,
        totalValue: (items as BOMItem[]).reduce((sum, item) => sum + (item.totalPrice || 0), 0),
        status: "Draft" as const,
        createdAt: new Date().toLocaleString(),
        prNumber: `PR-${new Date().getFullYear()}-${String(index + 1).padStart(3, '0')}`
      }));
      
      setPurchaseRequisitions(prs);
      setCurrentStep(3);
    } catch (error) {
      console.error('PR generation failed:', error);
      alert('Failed to generate purchase requisitions.');
    }
  };
  
  return (
    <div>
      {/* File upload */}
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
      />
      
      {/* Process button */}
      {selectedFile && currentStep === 1 && (
        <button onClick={handleProcess}>
          Process BOM File
        </button>
      )}
      
      {/* Generate PRs button */}
      {processedData && currentStep === 2 && (
        <button onClick={handleGeneratePRs}>
          Generate Purchase Requisitions
        </button>
      )}
      
      {/* Results */}
      {purchaseRequisitions.length > 0 && (
        <div>
          <h3>Generated Purchase Requisitions</h3>
          {purchaseRequisitions.map(pr => (
            <div key={pr.id}>
              <h4>{pr.supplier}</h4>
              <p>PR Number: {pr.prNumber}</p>
              <p>Items: {pr.totalItems}</p>
              <p>Total Value: ${pr.totalValue}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

### Document Processing with Progress

```tsx
import { useState, useRef } from 'react';
import { processDocuments, processPDFWithTesseract } from './DocumentAssistant';

const DocumentProcessor = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStage, setProcessingStage] = useState("");
  const [processedDocuments, setProcessedDocuments] = useState<Document[]>([]);
  
  const handleFileSelect = (files: File[]) => {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/tif',
      'application/pdf'
    ];
    
    const validFiles = files.filter(file => {
      if (!allowedTypes.includes(file.type)) {
        console.warn(`Invalid file type: ${file.name}`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        console.warn(`File too large: ${file.name}`);
        return false;
      }
      return true;
    });
    
    setSelectedFiles(validFiles);
  };
  
  const handleProcess = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessingStage("Starting processing...");
    
    const processedResults: Document[] = [];
    
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setProcessingStage(`Processing ${file.name}... (${i + 1}/${selectedFiles.length})`);
        
        if (file.type === "application/pdf") {
          // Client-side PDF processing
          const extractedText = await processPDFWithTesseract(file);
          
          const formData = new FormData();
          formData.append("document", file);
          formData.append("extractedText", extractedText);
          formData.append("pageCount", "1"); // You'd calculate this
          
          const response = await fetch("/api/process-document", {
            method: "POST",
            body: formData,
          });
          
          if (response.ok) {
            const result = await response.json();
            processedResults.push(result);
          }
        } else {
          // Server-side image processing
          const formData = new FormData();
          formData.append("document", file);
          
          const response = await fetch("/api/process-document", {
            method: "POST",
            body: formData,
          });
          
          if (response.ok) {
            const result = await response.json();
            processedResults.push(result);
          }
        }
        
        // Update progress
        const progress = Math.round(((i + 1) / selectedFiles.length) * 100);
        setProcessingProgress(progress);
      }
      
      setProcessedDocuments(processedResults);
      setProcessingStage("Processing completed!");
    } catch (error) {
      console.error('Processing failed:', error);
      setProcessingStage("Processing failed!");
    } finally {
      setIsProcessing(false);
    }
  };
  
  return (
    <div>
      {/* File input */}
      <input
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.tif,.tiff,.pdf"
        onChange={(e) => e.target.files && handleFileSelect(Array.from(e.target.files))}
      />
      
      {/* Process button */}
      {selectedFiles.length > 0 && !isProcessing && (
        <button onClick={handleProcess}>
          Process {selectedFiles.length} Document{selectedFiles.length > 1 ? 's' : ''}
        </button>
      )}
      
      {/* Progress indicator */}
      {isProcessing && (
        <div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${processingProgress}%` }}
            />
          </div>
          <p>{processingStage}</p>
          <p>{processingProgress}% complete</p>
        </div>
      )}
      
      {/* Results */}
      {processedDocuments.length > 0 && (
        <div>
          <h3>Processed Documents</h3>
          {processedDocuments.map(doc => (
            <div key={doc.id}>
              <h4>{doc.renamedName}</h4>
              <p>Supplier: {doc.supplier}</p>
              <p>PO Number: {doc.poNumber}</p>
              <p>Items: {doc.extractedData.items?.length || 0}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

### Theme Integration

```tsx
import { ThemeProvider, useTheme } from './components/ThemeProvider';
import { ThemeToggle } from './components/ThemeToggle';
import { cn } from '@/lib/utils';

const App = () => {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
};

const MainApp = () => {
  const { theme } = useTheme();
  
  return (
    <div className={cn(
      "min-h-screen",
      theme === 'dark' ? "bg-gray-900 text-white" : "bg-white text-gray-900"
    )}>
      <header className="flex justify-between items-center p-4">
        <h1>CMR Procurement System</h1>
        <ThemeToggle />
      </header>
      
      <main className="p-4">
        {/* App content */}
      </main>
    </div>
  );
};
```

---

This component documentation provides comprehensive examples and usage patterns for all components in the CMR Procurement System. Use these examples as templates for implementing similar functionality in your own projects.