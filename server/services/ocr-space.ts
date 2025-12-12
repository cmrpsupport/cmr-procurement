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
 * Detect and crop barcode region from the right side of the image
 * Barcodes typically have high-frequency vertical patterns
 */
async function detectAndCropBarcode(inputPath: string): Promise<string> {
  try {
    console.log(`  🔍 Detecting barcode region...`);

    const image = sharp(inputPath);
    const metadata = await image.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    if (width === 0 || height === 0) {
      console.log(`  ⚠️ Could not get image dimensions, skipping barcode detection`);
      return inputPath;
    }

    // Strategy: Crop out the right 35% of the image where barcodes typically appear
    // Keep the left 65% which contains the actual document data
    const cropWidth = Math.floor(width * 0.65);
    const croppedPath = inputPath.replace(/\.[^.]+$/, '_cropped.png');

    await sharp(inputPath)
      .extract({
        left: 0,
        top: 0,
        width: cropWidth,
        height: height
      })
      .png()
      .toFile(croppedPath);

    console.log(`  ✅ Cropped barcode region (kept left 65%, removed right 35%)`);
    return croppedPath;
  } catch (error) {
    console.error('  ❌ Barcode cropping failed:', error);
    return inputPath;
  }
}

/**
 * Preprocess image for better OCR accuracy - DISABLED
 * Simple preprocessing causes better results than complex processing
 */
async function preprocessImage(inputPath: string): Promise<string> {
  // Preprocessing disabled - Tesseract works better with original high-res images
  console.log(`  ℹ️ Using original image (preprocessing disabled for better quality)`);
  return inputPath;
}

/**
 * Process a single image with Tesseract.js (with preprocessing)
 */
export async function processWithOCRSpace(
  filePath: string,
  mimeType: string = 'image/png',
  language: string = 'eng'
): Promise<OCRResult> {
  let preprocessedPath: string | null = null;

  try {
    console.log(`📸 Processing file with Tesseract.js: ${path.basename(filePath)} (${mimeType})`);

    // Only preprocess images, not PDFs (Tesseract handles PDFs directly)
    let fileToProcess = filePath;
    if (mimeType.startsWith('image/')) {
      preprocessedPath = await preprocessImage(filePath);
      fileToProcess = preprocessedPath;
    } else {
      console.log('  📄 PDF file - skipping preprocessing, using direct Tesseract processing');
    }

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
      tessedit_ocr_engine_mode: '1', // Neural nets LSTM engine only
      tessedit_char_whitelist: '',  // Allow all characters
      preserve_interword_spaces: '1', // Preserve spacing
    });

    // Perform OCR
    console.log('  🔍 Running Tesseract OCR recognition...');
    const { data } = await worker.recognize(fileToProcess);

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
  } finally {
    // Clean up preprocessed file
    if (preprocessedPath && preprocessedPath !== filePath && fs.existsSync(preprocessedPath)) {
      try {
        fs.unlinkSync(preprocessedPath);
        console.log('  🧹 Cleaned up preprocessed file');
      } catch (err) {
        console.warn('  ⚠️ Could not delete preprocessed file:', err);
      }
    }
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
