const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

/**
 * Converts an array of image file paths into a single PDF document
 * @param {Array<string>} imagePaths - List of absolute paths to images
 * @param {string} outputPath - Target PDF path
 * @returns {Promise<number>} - Number of pages in the generated PDF
 */
const convertImagesToPDF = async (imagePaths, outputPath) => {
  const pdfDoc = await PDFDocument.create();

  for (const imgPath of imagePaths) {
    if (!fs.existsSync(imgPath)) continue;
    const imgBytes = fs.readFileSync(imgPath);
    const ext = path.extname(imgPath).toLowerCase();

    let image;
    if (ext === '.png') {
      image = await pdfDoc.embedPng(imgBytes);
    } else {
      // JPEG, JPG, WEBP, etc.
      image = await pdfDoc.embedJpg(imgBytes);
    }

    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
  return imagePaths.length;
};

module.exports = { convertImagesToPDF };
