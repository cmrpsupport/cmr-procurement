/**
 * Image Preprocessing Service
 * Enhances image quality before OCR for better text recognition
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

interface PreprocessingOptions {
  deskew?: boolean;
  denoise?: boolean;
  enhanceContrast?: boolean;
  sharpen?: boolean;
  threshold?: boolean;
  autoRotate?: boolean; // Automatically detect and correct rotation
}

/**
 * Preprocess image to improve OCR accuracy
 * @param imagePath - Path to the input image
 * @param options - Preprocessing options
 * @returns Path to preprocessed image
 */
export async function preprocessImage(
  imagePath: string,
  options: PreprocessingOptions = {
    deskew: true,
    denoise: true,
    enhanceContrast: true,
    sharpen: true,
    threshold: true,
    autoRotate: true
  }
): Promise<string> {
  try {
    console.log(`📸 Preprocessing image: ${path.basename(imagePath)}`);

    let image = sharp(imagePath);

    // Get image metadata
    const metadata = await image.metadata();
    console.log(`   Original: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

    // Auto-rotate based on EXIF orientation data (handles camera rotations)
    if (options.autoRotate) {
      console.log(`   ✓ Auto-rotating based on EXIF orientation`);
      image = image.rotate(); // Sharp automatically reads EXIF and rotates correctly
    }

    // Convert to grayscale for better OCR
    image = image.grayscale();

    // Enhance contrast using histogram normalization
    if (options.enhanceContrast) {
      console.log(`   ✓ Enhancing contrast`);
      image = image.normalize();
    }

    // Apply sharpening to make text edges clearer
    if (options.sharpen) {
      console.log(`   ✓ Sharpening edges`);
      image = image.sharpen({
        sigma: 1.0,
        m1: 1.0,
        m2: 0.5
      });
    }

    // Denoise - reduce noise while preserving edges
    if (options.denoise) {
      console.log(`   ✓ Reducing noise`);
      image = image.median(3); // 3x3 median filter
    }

    // Adaptive threshold for better text/background separation
    if (options.threshold) {
      console.log(`   ✓ Applying adaptive threshold`);
      // Use linear to adjust levels for better contrast
      image = image.linear(1.5, -50); // Increase contrast and reduce brightness
    }

    // Save preprocessed image
    const outputPath = imagePath.replace(path.extname(imagePath), '_preprocessed.png');
    await image.toFile(outputPath);

    const outputStats = fs.statSync(outputPath);
    console.log(`   ✅ Preprocessed image saved: ${(outputStats.size / 1024).toFixed(2)} KB`);

    return outputPath;
  } catch (error) {
    console.error('❌ Preprocessing failed:', error);
    console.warn('⚠️  Using original image instead');
    return imagePath; // Fallback to original if preprocessing fails
  }
}

/**
 * Preprocess multiple images in batch
 * @param imagePaths - Array of image paths
 * @param options - Preprocessing options
 * @returns Array of preprocessed image paths
 */
export async function preprocessImages(
  imagePaths: string[],
  options?: PreprocessingOptions
): Promise<string[]> {
  console.log(`📸 Preprocessing ${imagePaths.length} images...`);

  const preprocessedPaths: string[] = [];

  for (const imagePath of imagePaths) {
    const preprocessedPath = await preprocessImage(imagePath, options);
    preprocessedPaths.push(preprocessedPath);
  }

  console.log(`✅ Preprocessed ${preprocessedPaths.length} images`);
  return preprocessedPaths;
}

/**
 * Clean up preprocessed images
 * @param imagePaths - Array of preprocessed image paths to delete
 */
export function cleanupPreprocessedImages(imagePaths: string[]): void {
  try {
    imagePaths.forEach(imagePath => {
      if (imagePath.includes('_preprocessed') && fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    });
    console.log('🗑️  Cleaned up preprocessed images');
  } catch (error) {
    console.warn('⚠️  Failed to cleanup preprocessed images:', error);
  }
}
