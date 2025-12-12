import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { pdfToPng } from 'pdf-to-png-converter';

interface OCRResult {
  text: string;
  confidence: number;
}

/**
 * Process a single image with Tesseract.js
 * Note: Preprocessing disabled - Tesseract works better with original high-res images
 */
export async function processWithOCRSpace(
  filePath: string,
  mimeType: string = 'image/png',
  language: string = 'eng'
): Promise<OCRResult> {
  try {
    console.log(`📸 Processing file with Tesseract.js: ${path.basename(filePath)} (${mimeType})`);
    console.log('  ℹ️ Using original image (preprocessing disabled for better quality)');

    // Create Tesseract worker with optimized settings
    const worker = await createWorker(language, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`  📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    // Set Tesseract parameters for better accuracy
    await worker.setParameters({
      tessedit_pageseg_mode: '1',  // Automatic page segmentation with OSD
      preserve_interword_spaces: '1', // Preserve spacing
    });

    // Perform OCR
    console.log('  🔍 Running Tesseract OCR recognition...');
    const { data } = await worker.recognize(filePath);

    // Clean up worker
    await worker.terminate();

    const extractedText = data.text;
    const confidence = data.confidence / 100; // Convert to 0-1 scale

    console.log(`✅ Tesseract OCR completed. Text length: ${extractedText.length}, Confidence: ${(confidence * 100).toFixed(1)}%`);

    return {
      text: extractedText,
      confidence: confidence,
    };
  } catch (error) {
    console.error('❌ Tesseract OCR error:', error);
    throw error;
  }
}

/**
 * Convert PDF page to PNG using pure Node.js library (no ImageMagick required)
 */
async function convertPDFPageToPNG(pdfPath: string, pageNumber: number): Promise<string> {
  try {
    console.log(`  🖼️ Converting PDF page ${pageNumber} to PNG using pdf-to-png-converter...`);

    const outputPath = `${pdfPath}_page_${pageNumber}.png`;

    // Convert specific page from PDF to PNG
    const pngPages = await pdfToPng(pdfPath, {
      disableFontFace: false,
      useSystemFonts: false,
      viewportScale: 2.0,
      pagesToProcess: [pageNumber],
      strictPagesToProcess: false,
      verbosityLevel: 0
    });

    if (!pngPages || pngPages.length === 0) {
      throw new Error(`Failed to convert PDF page ${pageNumber}`);
    }

    // Save the PNG buffer to file
    fs.writeFileSync(outputPath, pngPages[0].content);

    console.log(`  ✅ PDF page converted to PNG: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (error) {
    console.error(`  ❌ PDF to PNG conversion failed:`, error);
    throw error;
  }
}

/**
 * Process a PDF file with Tesseract (converts to PNG first using pdf-to-png-converter)
 */
export async function processPDFWithOCRSpace(
  filePath: string,
  pageCount: number
): Promise<{ text: string; pageNumber: number; confidence: number }[]> {
  console.log(`📄 Processing PDF with ${pageCount} pages using Tesseract + pdf-to-png-converter`);

  const results = [];

  // Process each page individually
  for (let i = 0; i < pageCount; i++) {
    const pageNum = i + 1;
    console.log(`  → Processing page ${pageNum}/${pageCount}`);

    let pngPath: string | null = null;

    try {
      // Convert PDF page to PNG
      pngPath = await convertPDFPageToPNG(filePath, pageNum);

      // Process PNG with Tesseract (with preprocessing)
      const result = await processWithOCRSpace(pngPath, 'image/png');

      results.push({
        text: result.text,
        pageNumber: pageNum,
        confidence: result.confidence,
      });
    } finally {
      // Clean up temporary PNG file
      if (pngPath && fs.existsSync(pngPath)) {
        fs.unlinkSync(pngPath);
        console.log(`  🧹 Cleaned up temporary PNG: ${path.basename(pngPath)}`);
      }
    }
  }

  console.log(`✅ Completed processing all ${pageCount} pages`);
  return results;
}
