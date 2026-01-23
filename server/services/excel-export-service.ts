import ExcelJS from 'exceljs';

interface DocumentData {
  id: string;
  originalName: string;
  renamedName: string;
  supplier?: string;
  poNumber?: string;
  prNumber?: string;
  projectNumber?: string;
  jobNumber?: string;
  doNumber?: string;
  date?: string;
  deliveryDate?: string;
  extractedData?: any;
  uploadTime?: string;
  fileSize?: number;
}

/**
 * Generate Excel file with multiple sheets from document data
 */
export async function generateExcelReport(documents: DocumentData[]): Promise<Buffer> {
  console.log(`📊 generateExcelReport called with ${documents.length} document(s):`);
  documents.forEach((doc, index) => {
    console.log(`   ${index + 1}. ID: ${doc.id}, Name: ${doc.originalName}, Supplier: ${doc.supplier}`);
  });

  const workbook = new ExcelJS.Workbook();

  // Set workbook properties
  workbook.creator = 'CMR Procurement System';
  workbook.created = new Date();
  workbook.modified = new Date();

  // ==========================================
  // SHEET 1: Summary
  // ==========================================
  const summarySheet = workbook.addWorksheet('Summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] // Freeze header row
  });

  // Summary header with styling
  const summaryHeaders = [
    'Document ID',
    'File Name',
    'Supplier',
    'PO Number',
    'PR Number',
    'DO Number',
    'Job Number',
    'Date',
    'Delivery Date',
    'Items Count',
    'Quality %',
    'OCR Confidence %',
    'Status'
  ];

  const summaryHeaderRow = summarySheet.addRow(summaryHeaders);
  summaryHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summaryHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  summaryHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
  summaryHeaderRow.height = 20;

  // Add data rows
  documents.forEach((doc) => {
    const itemsCount = doc.extractedData?.items?.length || 0;
    const quality = doc.extractedData?.confidence || 0;
    const ocrConfidence = doc.extractedData?.rawData?.ocrConfidence || 0;

    // Determine status
    let status = '✅ Complete';
    const missingFields = [];
    if (!doc.supplier || doc.supplier === 'Not found') missingFields.push('Supplier');
    if (!doc.poNumber || doc.poNumber === 'Not found') missingFields.push('PO#');
    if (!doc.doNumber || doc.doNumber === 'Not found') missingFields.push('DO#');

    if (missingFields.length > 0) {
      status = `⚠️ Missing: ${missingFields.join(', ')}`;
    }
    if (quality < 50) {
      status = '❌ Poor Quality';
    }

    const row = summarySheet.addRow([
      doc.id,
      doc.originalName,
      doc.supplier || 'Not found',
      doc.poNumber || 'Not found',
      doc.prNumber || 'Not found',
      doc.doNumber || 'Not found',
      doc.jobNumber || 'Not found',
      doc.date || 'Not found',
      doc.deliveryDate || 'Not found',
      itemsCount,
      quality,
      ocrConfidence,
      status
    ]);

    // Color code based on quality
    if (quality >= 80) {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }; // Light green
    } else if (quality >= 60) {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } }; // Light yellow
    } else {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; // Light red
    }
  });

  // Auto-fit columns
  summarySheet.columns.forEach((column, index) => {
    let maxLength = summaryHeaders[index].length;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value?.toString() || '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(maxLength + 2, 50); // Max width 50
  });

  // ==========================================
  // SHEET 2: Items Detail
  // ==========================================
  const itemsSheet = workbook.addWorksheet('Items Detail', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  const itemsHeaders = [
    'Document ID',
    'File Name',
    'PO Number',
    'Item #',
    'Part Number',
    'Description',
    'Quantity',
    'Full Item Text'
  ];

  const itemsHeaderRow = itemsSheet.addRow(itemsHeaders);
  itemsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  itemsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  itemsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
  itemsHeaderRow.height = 20;

  // Add items data
  documents.forEach((doc) => {
    const items = doc.extractedData?.items || [];

    if (items.length === 0) {
      itemsSheet.addRow([
        doc.id,
        doc.originalName,
        doc.poNumber || 'Not found',
        '',
        '',
        'No items found',
        '',
        ''
      ]);
    } else {
      items.forEach((item: any, index: number) => {
        // Parse item if it's a string
        let partNumber = '';
        let description = '';
        let quantity = '';
        let fullText = '';

        if (typeof item === 'string') {
          fullText = item;
          // Try to extract structured data from string
          const partMatch = item.match(/^([\w\-\/]+)\s*[:\-]?\s*/);
          if (partMatch) partNumber = partMatch[1];

          const qtyMatch = item.match(/(\d+\s*(?:PC|PCS|EA|pcs|pc|ea))/i);
          if (qtyMatch) quantity = qtyMatch[1];

          description = item.replace(partMatch?.[0] || '', '').trim();
        } else if (typeof item === 'object') {
          partNumber = item.partNumber || item.partNo || '';
          description = item.description || item.desc || '';
          quantity = item.quantity || item.qty || '';
          fullText = item.fullText || JSON.stringify(item);
        }

        itemsSheet.addRow([
          doc.id,
          doc.originalName,
          doc.poNumber || 'Not found',
          index + 1,
          partNumber,
          description,
          quantity,
          fullText
        ]);
      });
    }
  });

  // Auto-fit columns
  itemsSheet.columns.forEach((column, index) => {
    let maxLength = itemsHeaders[index].length;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value?.toString() || '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(maxLength + 2, 60);
  });

  // ==========================================
  // SHEET 3: Processing Details
  // ==========================================
  const detailsSheet = workbook.addWorksheet('Processing Details', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  const detailsHeaders = [
    'Document ID',
    'File Name',
    'Upload Time',
    'File Size (MB)',
    'Page Count',
    'OCR Method',
    'OCR Confidence %',
    'Extraction Quality %',
    'Critical Fields Found',
    'Optional Fields Found',
    'Quality Warning'
  ];

  const detailsHeaderRow = detailsSheet.addRow(detailsHeaders);
  detailsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  detailsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFC000' }
  };
  detailsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
  detailsHeaderRow.height = 20;

  // Add processing details
  documents.forEach((doc) => {
    const rawData = doc.extractedData?.rawData || {};
    const fileSize = doc.fileSize ? (doc.fileSize / 1024 / 1024).toFixed(2) : 'N/A';
    const pageCount = doc.extractedData?.pageCount || rawData.pageCount || 1;
    const ocrMethod = rawData.ocrMethod || 'Unknown';
    const ocrConfidence = rawData.ocrConfidence || 0;
    const quality = doc.extractedData?.confidence || 0;

    // Count fields
    const criticalFields = [doc.supplier, doc.poNumber, doc.doNumber, doc.date]
      .filter(f => f && f !== 'Not found').length;
    const optionalFields = [doc.prNumber, doc.jobNumber, doc.deliveryDate]
      .filter(f => f && f !== 'Not found').length;

    const qualityWarning = doc.extractedData?.qualityWarning || 'None';

    detailsSheet.addRow([
      doc.id,
      doc.originalName,
      doc.uploadTime || 'N/A',
      fileSize,
      pageCount,
      ocrMethod,
      ocrConfidence,
      quality,
      `${criticalFields}/4`,
      `${optionalFields}/3`,
      qualityWarning
    ]);
  });

  // Auto-fit columns
  detailsSheet.columns.forEach((column, index) => {
    let maxLength = detailsHeaders[index].length;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value?.toString() || '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(maxLength + 2, 50);
  });

  // ==========================================
  // SHEET 4: Statistics
  // ==========================================
  const statsSheet = workbook.addWorksheet('Statistics');

  // Calculate statistics
  const totalDocs = documents.length;
  const avgQuality = documents.reduce((sum, doc) => sum + (doc.extractedData?.confidence || 0), 0) / totalDocs || 0;
  const avgOcrConfidence = documents.reduce((sum, doc) => sum + (doc.extractedData?.rawData?.ocrConfidence || 0), 0) / totalDocs || 0;
  const totalItems = documents.reduce((sum, doc) => sum + (doc.extractedData?.items?.length || 0), 0);
  const docsWithSupplier = documents.filter(doc => doc.supplier && doc.supplier !== 'Not found').length;
  const docsWithPO = documents.filter(doc => doc.poNumber && doc.poNumber !== 'Not found').length;
  const docsWithDO = documents.filter(doc => doc.doNumber && doc.doNumber !== 'Not found').length;

  // Add statistics
  statsSheet.addRow(['CMR Procurement - Export Statistics']);
  statsSheet.getRow(1).font = { bold: true, size: 16 };
  statsSheet.addRow([]);

  statsSheet.addRow(['Export Date:', new Date().toLocaleString()]);
  statsSheet.addRow(['Total Documents:', totalDocs]);
  statsSheet.addRow(['Average Extraction Quality:', `${avgQuality.toFixed(1)}%`]);
  statsSheet.addRow(['Average OCR Confidence:', `${avgOcrConfidence.toFixed(1)}%`]);
  statsSheet.addRow(['Total Items Extracted:', totalItems]);
  statsSheet.addRow([]);

  statsSheet.addRow(['Field Extraction Success:']);
  statsSheet.addRow(['  Supplier Found:', `${docsWithSupplier}/${totalDocs} (${(docsWithSupplier/totalDocs*100).toFixed(1)}%)`]);
  statsSheet.addRow(['  PO Number Found:', `${docsWithPO}/${totalDocs} (${(docsWithPO/totalDocs*100).toFixed(1)}%)`]);
  statsSheet.addRow(['  DO Number Found:', `${docsWithDO}/${totalDocs} (${(docsWithDO/totalDocs*100).toFixed(1)}%)`]);

  statsSheet.getColumn(1).width = 30;
  statsSheet.getColumn(2).width = 40;

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate Excel file for a single document
 */
export async function generateSingleDocumentExcel(doc: DocumentData): Promise<Buffer> {
  return generateExcelReport([doc]);
}
