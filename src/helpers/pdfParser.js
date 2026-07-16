import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import { extractTextWithPpOcr } from './ppOcr';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

/**
 * Extracts text from an uploaded ticket file. PDFs go through text-layer
 * extraction with an OCR fallback; images go straight to OCR.
 * @param {File} file - The uploaded PDF or image file
 * @returns {Promise<string>} - The extracted raw text
 */
export async function extractTextFromFile(file, options = {}) {
  if (file.type.startsWith('image/')) {
    return extractTextFromImage(file, options);
  }
  return extractTextFromPDF(file, options);
}

// Photos of receipts (angled, glare, low contrast) are the hardest OCR case,
// so we don't trust a single engine: take PP-OCRv5's read, but if it comes back
// thin (a common failure on noisy photos) also run Tesseract and keep whichever
// recovered more text. Clean screenshots/PDFs still short-circuit on the first.
const MIN_CONFIDENT_TEXT = 24;

async function extractTextFromImage(file, options = {}) {
  try {
    const ppText = (await extractTextWithPpOcr(file, options).catch(() => null))?.text?.trim() || '';
    if (ppText.length >= MIN_CONFIDENT_TEXT) return ppText;

    const result = await Tesseract.recognize(file, 'eng', {
      logger: (message) => console.log(message),
    }).catch(() => null);
    const tessText = result?.data?.text?.trim() || '';

    // Keep the richer of the two reads.
    return tessText.length > ppText.length ? tessText : ppText;
  } catch (error) {
    console.error('Error parsing image:', error);
    throw new Error(error?.message || 'Failed to extract text from image', { cause: error });
  }
}

/**
 * Extracts text from a PDF file using OCR (Tesseract) or direct text extraction
 * @param {File} file - The uploaded PDF file
 * @returns {Promise<string>} - The extracted raw text
 */
export async function extractTextFromPDF(file, options = {}) {
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
      const ppOcr = await extractTextWithPpOcr(canvas, options).catch(() => null);
      if (ppOcr?.text?.trim()) {
        ocrText += ppOcr.text + '\n';
        continue;
      }

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
