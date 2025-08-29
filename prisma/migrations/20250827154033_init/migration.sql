-- CreateTable
CREATE TABLE "bom_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "totalItems" INTEGER,
    "suppliersFound" INTEGER,
    "processingTime" TEXT
);

-- CreateTable
CREATE TABLE "bom_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supplier" TEXT NOT NULL,
    "symbol" TEXT,
    "category" TEXT,
    "remarks" TEXT,
    "unitPrice" REAL NOT NULL DEFAULT 0.0,
    "totalPrice" REAL NOT NULL DEFAULT 0.0,
    "rowIndex" INTEGER NOT NULL,
    "bomFileId" TEXT NOT NULL,
    CONSTRAINT "bom_items_bomFileId_fkey" FOREIGN KEY ("bomFileId") REFERENCES "bom_files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prNumber" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "totalValue" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "bomFileId" TEXT NOT NULL,
    CONSTRAINT "purchase_requisitions_bomFileId_fkey" FOREIGN KEY ("bomFileId") REFERENCES "bom_files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pr_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "symbol" TEXT,
    "category" TEXT,
    "remarks" TEXT,
    "unitPrice" REAL NOT NULL DEFAULT 0.0,
    "totalPrice" REAL NOT NULL DEFAULT 0.0,
    "prId" TEXT NOT NULL,
    "bomItemId" TEXT,
    CONSTRAINT "pr_items_prId_fkey" FOREIGN KEY ("prId") REFERENCES "purchase_requisitions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pr_items_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "bom_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "supplier" TEXT,
    "poNumber" TEXT,
    "projectNumber" TEXT,
    "deliveryDate" DATETIME,
    "totalAmount" REAL,
    "filePath" TEXT
);

-- CreateTable
CREATE TABLE "document_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "quantity" TEXT,
    "unitPrice" TEXT,
    "totalPrice" TEXT,
    "documentId" TEXT NOT NULL,
    CONSTRAINT "document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dataSource" TEXT,
    "recordCount" INTEGER,
    "completionRate" REAL
);

-- CreateTable
CREATE TABLE "report_sections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "dataCount" INTEGER,
    "reportId" TEXT NOT NULL,
    CONSTRAINT "report_sections_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_prNumber_key" ON "purchase_requisitions"("prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");
