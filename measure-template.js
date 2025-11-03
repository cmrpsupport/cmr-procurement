import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function measureTemplate() {
  const templateBytes = fs.readFileSync('public/PR Export Template.pdf');
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];

  const width = page.getWidth();
  const height = page.getHeight();

  console.log('PDF Dimensions:');
  console.log('Width:', width);
  console.log('Height:', height);

  // Based on visual inspection of template, calculate row positions
  // Template has header section and then 18 item rows
  const tableStartY = 528; // Current starting position

  // Measure from the screenshots - rows are evenly spaced
  // Row 1 starts at Y=528, and by row 14 we can see the drift
  // Let's calculate: if row 1 is good and row 14 is too low,
  // we need to measure the actual spacing

  console.log('\nCalculating row positions for 18 rows:');
  console.log('Starting Y:', tableStartY);

  // Try different row heights to find the correct one
  const testHeights = [18.0, 18.5, 19.0, 19.5, 20.0];

  testHeights.forEach(rowHeight => {
    console.log(`\n--- Row Height: ${rowHeight}pt ---`);
    for (let i = 0; i < 18; i++) {
      const y = tableStartY - (i * rowHeight);
      console.log(`Row ${i + 1}: Y=${y.toFixed(2)}`);
    }
    const endY = tableStartY - (17 * rowHeight);
    console.log(`End Y: ${endY.toFixed(2)}`);
    console.log(`Total height: ${(tableStartY - endY).toFixed(2)}pt`);
  });
}

measureTemplate();
