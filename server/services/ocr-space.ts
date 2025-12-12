import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

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
 * Convert PDF page to PNG using ImageMagick
 */
async function convertPDFPageToPNG(pdfPath: string, pageNumber: number): Promise<string> {
  try {
    console.log(`  🖼️ Converting PDF page ${pageNumber} to PNG using ImageMagick...`);

    const outputPath = `${pdfPath}_page_${pageNumber}.png`;
    const pageIndex = pageNumber - 1; // ImageMagick uses 0-based indexing

    // Use ImageMagick with enhanced settings for OCR
    // -density 600: Very high resolution for crisp text
    // -quality 100: Maximum quality
    // -colorspace Gray: Convert to grayscale immediately
    // -type Grayscale: Ensure grayscale output
    const command = `magick -density 600 "${pdfPath}[${pageIndex}]" -colorspace Gray -type Grayscale -quality 100 "${outputPath}"`;

    console.log(`  🔧 Running: ${command}`);
    await exec(command);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`PNG file was not created: ${outputPath}`);
    }

    console.log(`  ✅ PDF page converted to PNG: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (error) {
    console.error(`  ❌ PDF to PNG conversion failed:`, error);
    throw error;
  }
}

/**
 * Process a PDF file with Tesseract (converts to PNG first using ImageMagick)
 */
export async function processPDFWithOCRSpace(
  filePath: string,
  pageCount: number
): Promise<{ text: string; pageNumber: number; confidence: number }[]> {
  console.log(`📄 Processing PDF with ${pageCount} pages using Tesseract + ImageMagick`);

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
