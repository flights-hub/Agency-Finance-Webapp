import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

/**
 * Extracts text from a PDF file using OCR (Tesseract) or direct text extraction
 * @param {File} file - The uploaded PDF file
 * @returns {Promise<string>} - The extracted raw text
 */
export async function extractTextFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    // First try direct text extraction (much faster and more accurate for digital tickets)
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    // If we found text, return it. If the PDF was just an image, fullText will be empty or very short.
    if (fullText.trim().length > 50) {
      return fullText;
    }

    // Fallback: OCR using Tesseract.js if it's a scanned image PDF.
    console.log('No text layer found, falling back to OCR...');
    
    let ocrText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport: viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');

      const result = await Tesseract.recognize(dataUrl, 'eng', {
        logger: (message) => console.log(message),
      });
      ocrText += result.data.text + '\n';
    }
    
    return ocrText;
    
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw new Error(error?.message || 'Failed to extract text from PDF', { cause: error });
  }
}
