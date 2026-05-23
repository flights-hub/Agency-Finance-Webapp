import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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

    // Fallback: OCR using Tesseract.js if it's a scanned image PDF
    console.log("No text layer found, falling back to OCR...");
    
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
        logger: m => console.log(m)
      });
      ocrText += result.data.text + '\n';
    }
    
    return ocrText;
    
  } catch (error) {
    console.error("Error parsing PDF:", error);
    throw new Error("Failed to extract text from PDF", { cause: error });
  }
}

/**
 * Parses raw text to find ticket details using regex
 * @param {string} text - Raw text from PDF
 * @returns {Object} - Extracted fields with confidence scores
 */
export function parseTicketData(text) {
  const result = {
    pnr: { value: '', confidence: 'low' },
    passenger_name: { value: '', confidence: 'low' },
    ticket_no: { value: '', confidence: 'low' },
    airline: { value: '', confidence: 'low' },
    sector: { value: '', confidence: 'low' },
    outbound_date: { value: '', confidence: 'low' },
    inbound_date: { value: '', confidence: 'low' },
    fare_sold: { value: 0, confidence: 'low' },
    fare_issued: { value: 0, confidence: 'low' }
  };

  // 1. Find PNR (typically 6 uppercase alphanumeric chars)
  // Look for keywords nearby like "Booking Ref", "PNR", "Locator"
  const pnrRegex = /(?:PNR|BOOKING REF|LOCATOR|REFERENCE)[\s:-]*([A-Z0-9]{6})\b/i;
  const pnrMatch = text.match(pnrRegex);
  if (pnrMatch) {
    result.pnr = { value: pnrMatch[1], confidence: 'high' };
  } else {
    // Fallback: just look for any 6 char alphanumeric block
    const fallbackPnr = text.match(/\b([A-Z0-9]{6})\b/);
    if (fallbackPnr) result.pnr = { value: fallbackPnr[1], confidence: 'medium' };
  }

  // 2. Find Ticket Number (e.g. 055-1234567890 or 0551234567890)
  const tktRegex = /(?:TICKET|TKT|ETKT)[\sA-Z:-]*(\d{3}[-\s]?\d{10})\b/i;
  const tktMatch = text.match(tktRegex);
  if (tktMatch) {
    result.ticket_no = { value: tktMatch[1].replace(/\s/g, ''), confidence: 'high' };
  } else {
    const fallbackTkt = text.match(/\b(\d{3}[-\s]?\d{10})\b/);
    if (fallbackTkt) result.ticket_no = { value: fallbackTkt[1].replace(/\s/g, ''), confidence: 'medium' };
  }

  // 3. Passenger Name (Very heuristic, looks for NAME or MR/MRS)
  const nameRegex = /(?:PASSENGER|NAME|MR|MRS|MS)[\s:-]*([A-Z]+\s[A-Z]+(?:[\sA-Z]*))/i;
  const nameMatch = text.match(nameRegex);
  if (nameMatch) {
    let name = nameMatch[1].trim();
    if(name.length > 3) {
      result.passenger_name = { value: name, confidence: 'medium' };
    }
  }

  // 4. Airline Matching
  const airlines = ["ITA Airways", "Air India", "Emirates", "Lufthansa", "Turkish Airlines", "Qatar Airways"];
  for (const airline of airlines) {
    if (text.toLowerCase().includes(airline.toLowerCase())) {
      result.airline = { value: airline, confidence: 'high' };
      break;
    }
  }

  // 5. Sector (FCO-DEL, FCO to DEL, etc.)
  const sectorMatch = text.match(/\b([A-Z]{3})\s*(?:-|TO|\/)\s*([A-Z]{3})\b/i);
  if (sectorMatch) {
    result.sector = { value: `${sectorMatch[1].toUpperCase()}-${sectorMatch[2].toUpperCase()}`, confidence: 'medium' };
  }

  // 6. ISO-style dates when available.
  const dates = [...text.matchAll(/\b(20\d{2}[-/]\d{2}[-/]\d{2})\b/g)].map(match => match[1].replace(/\//g, '-'));
  if (dates[0]) result.outbound_date = { value: dates[0], confidence: 'medium' };
  if (dates[1]) result.inbound_date = { value: dates[1], confidence: 'medium' };

  // 7. Total Fare (Look for EUR, USD, INR, or currency symbol near a number)
  const fareRegex = /(?:TOTAL|FARE|AMOUNT|EUR|USD|INR|€|\$)[\s:-]*([\d,]+\.?\d*)/i;
  const fareMatch = text.match(fareRegex);
  if (fareMatch) {
    const fare = parseFloat(fareMatch[1].replace(/,/g, ''));
    if (!isNaN(fare)) {
      result.fare_sold = { value: fare, confidence: 'medium' };
    }
  }

  const issuedRegex = /(?:ISSUED|NET|COST|SUPPLIER)[\s:-]*(?:EUR|USD|INR|€|\$)?\s*([\d,]+\.?\d*)/i;
  const issuedMatch = text.match(issuedRegex);
  if (issuedMatch) {
    const fareIssued = parseFloat(issuedMatch[1].replace(/,/g, ''));
    if (!isNaN(fareIssued)) {
      result.fare_issued = { value: fareIssued, confidence: 'medium' };
    }
  }

  return result;
}
