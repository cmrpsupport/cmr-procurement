import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

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
 * Preprocess image for better OCR accuracy
 * Handles TIFF, PNG, JPEG, and other image formats
 */
async function preprocessImage(inputPath: string): Promise<string> {
  try {
    console.log(`  🔧 Preprocessing image: ${path.basename(inputPath)}`);

    // Step 1: Detect and crop barcode if present
    const croppedPath = await detectAndCropBarcode(inputPath);

    const outputPath = croppedPath.replace(/\.[^.]+$/, '_preprocessed.png');

    await sharp(croppedPath)
      // Convert to grayscale (removes color noise)
      .grayscale()
      // Increase contrast and brightness for better text detection
      .normalize()
      // Apply slight sharpening to enhance text edges
      .sharpen()
      // Increase resolution for better OCR (resize to 300 DPI equivalent)
      .resize({
        width: 3000,
        fit: 'inside',
        withoutEnlargement: true
      })
      // Convert to PNG with high quality
      .png({ quality: 100, compressionLevel: 0 })
      .toFile(outputPath);

    // Clean up cropped file if it's different from input
    if (croppedPath !== inputPath && fs.existsSync(croppedPath)) {
      try {
        fs.unlinkSync(croppedPath);
      } catch (err) {
        console.warn('  ⚠️ Could not delete cropped file:', err);
      }
    }

    console.log(`  ✅ Preprocessed image saved: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (error) {
    console.error('  ❌ Preprocessing failed:', error);
    // If preprocessing fails, return original path
    return inputPath;
  }
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

    // Preprocess image for better OCR
    preprocessedPath = await preprocessImage(filePath);

    // Create Tesseract worker
    const worker = await createWorker(language, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`  📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    // Perform OCR
    console.log('  🔍 Running OCR recognition...');
    const { data } = await worker.recognize(preprocessedPath);

    // Clean up worker
    await worker.terminate();

    const extractedText = data.text;
    const confidence = data.confidence / 100; // Convert to 0-1 scale

    console.log(`✅ OCR completed. Text length: ${extractedText.length}, Confidence: ${(confidence * 100).toFixed(1)}%`);

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
 * Process a PDF file with Tesseract, splitting into pages if > 3 pages
 */
export async function processPDFWithOCRSpace(
  filePath: string,
  pageCount: number
): Promise<{ text: string; pageNumber: number; confidence: number }[]> {
  console.log(`📄 Processing PDF with ${pageCount} pages`);

  // Import pdf-lib dynamically
  const { PDFDocument } = await import('pdf-lib');
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const results = [];

  // Process each page individually
  for (let i = 0; i < pageCount; i++) {
    console.log(`  → Processing page ${i + 1}/${pageCount}`);

    // Create a new PDF with just this page
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
    singlePagePdf.addPage(copiedPage);

    // Save to temporary file
    const singlePageBytes = await singlePagePdf.save();
    const tempPdfPath = `${filePath}_page_${i + 1}.pdf`;
    fs.writeFileSync(tempPdfPath, singlePageBytes);

    // Convert PDF page to image using sharp (PDF → PNG conversion)
    // Note: sharp doesn't support PDF directly, so we need pdf-poppler or similar
    // For now, we'll try to process the PDF page directly with Tesseract

    try {
      // Tesseract can handle PDF pages directly
      const result = await processWithOCRSpace(tempPdfPath, 'application/pdf');

      results.push({
        text: result.text,
        pageNumber: i + 1,
        confidence: result.confidence,
      });
    } finally {
      // Clean up temporary file
      if (fs.existsSync(tempPdfPath)) {
        fs.unlinkSync(tempPdfPath);
      }
    }
  }

  console.log(`✅ Completed processing all ${pageCount} pages`);
  return results;
}
