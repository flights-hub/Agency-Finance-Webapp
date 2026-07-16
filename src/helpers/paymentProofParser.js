export const PAYMENT_PROOF_PARSER_VERSION = 'payment-proof-v2';

const CURRENCY_SYMBOLS = {
  '\u20ac': 'EUR',
  '\u00e2\u201a\u00ac': 'EUR',
  eur: 'EUR',
  '\u20b9': 'INR',
  '\u00e2\u201a\u00b9': 'INR',
  '\u00a5': 'INR',
  inr: 'INR',
  rs: 'INR',
  'rs.': 'INR',
  rupee: 'INR',
  rupees: 'INR',
  '$': 'USD',
  usd: 'USD',
  '\u00a3': 'GBP',
  '\u00c2\u00a3': 'GBP',
  gbp: 'GBP',
};
const CURRENCY_PATTERN = String.raw`(?:EUR|INR|USD|GBP|Rs\.?|Rupees?|\u20ac|\u00e2\u201a\u00ac|\u20b9|\u00e2\u201a\u00b9|\u00a5|\$|\u00a3|\u00c2\u00a3|e)`;
const STRICT_CURRENCY_PATTERN = String.raw`(?:EUR|INR|USD|GBP|Rs\.?|Rupees?|\u20ac|\u00e2\u201a\u00ac|\u20b9|\u00e2\u201a\u00b9|\u00a5|\$|\u00a3|\u00c2\u00a3)`;
const IBAN_PATTERN = '[A-Z]{2}\\d{2}[A-Z0-9]{11,30}';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function receiptLines(value) {
  return String(value || '').split(/\r?\n/).map(compact).filter(Boolean);
}

function moneyNumber(value) {
  const raw = String(value || '').replace(/[^\d.,-]/g, '');
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  const integer = decimalIndex === -1 ? raw : raw.slice(0, decimalIndex);
  const decimals = decimalIndex === -1 ? '' : raw.slice(decimalIndex + 1);
  const normalized = `${integer.replace(/[.,]/g, '')}${decimals ? `.${decimals.replace(/[^\d]/g, '')}` : ''}`;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return date.toISOString().slice(0, 10);
}

function parseDate(text) {
  const value = String(text || '');
  let match = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:T|\b)/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    // Italian and Indian receipts are day-first (DD/MM/YYYY). Only fall back to
    // month-first when the second field cannot be a month (e.g. 07/25/2026).
    const dayFirst = second <= 12;
    return isoDate(Number(match[3]), dayFirst ? second : first, dayFirst ? first : second);
  }

  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    gen: 1, gennaio: 1, febb: 2, febbraio: 2, marzo: 3, aprile: 4, mag: 5, maggio: 5,
    giu: 6, giugno: 6, lug: 7, luglio: 7, ago: 8, agosto: 8, sett: 9, settembre: 9,
    ott: 10, ottobre: 10, novembre: 11, dic: 12, dicembre: 12,
  };
  match = value.match(/\b(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(20\d{2})\b/);
  if (match) return isoDate(Number(match[3]), months[match[2].toLowerCase()], Number(match[1]));

  match = value.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+'?(\d{2})\b/);
  if (match) return isoDate(2000 + Number(match[3]), months[match[2].toLowerCase()], Number(match[1]));
  return '';
}

function parseDayMonthYear(text) {
  const match = String(text || '').match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  return match ? isoDate(Number(match[3]), Number(match[2]), Number(match[1])) : '';
}

function detectMethod(text) {
  const upper = text.toUpperCase();
  if (/\b(UPI|UTR|PHONEPE|PAYTM|BHIM|GOOGLE PAY|GPAY)\b/.test(upper)) return 'UPI';
  if (/\b(BANK DEPOSIT|BANK ACCOUNT|TRANSFER RECEIPT|BANK|BANCA|BANCO|IBAN|CRO|TRN|TID|BONIFICO|SEPA|MOONEY|BENEFICIARY|BENEFICIARIO|SENDER|ACCOUNT|VOSTRA DISPOSIZIONE|VS\.DISP)\b/.test(upper)) return 'BANK_TRANSFER';
  if (/\b(REMITLY|STRIPE|PAYPAL|PAYMENT LINK|GATEWAY|REVOLUT PAY)\b/.test(upper)) return 'ONLINE_PAYMENT';
  if (/\b(CARD|VISA|MASTERCARD|AMEX|AUTH(?:ORIZATION)? CODE|POS|TERMINAL|STAN|RRN)\b/.test(upper)) return 'POS_TERMINAL';
  if (/\b(CHEQUE|CHECK)\b/.test(upper)) return 'CHEQUE';
  if (/\b(CASH)\b/.test(upper)) return 'CASH';
  return '';
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compact(match[1]).replace(/[.,;:]+$/, '');
  }
  return '';
}

function currencyCode(value, context = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'e' && /\b(?:bonifico|commissioni|importo|totale|total)\b/i.test(context)) return 'EUR';
  return CURRENCY_SYMBOLS[token] || '';
}

function moneyMatchToAmount(match, context) {
  if (!match) return {};
  const firstIsCurrency = currencyCode(match[1], context);
  const amountToken = firstIsCurrency ? match[2] : match[1];
  const currencyToken = firstIsCurrency ? match[1] : match[2] || match[3] || '';
  return {
    amount_paid: moneyNumber(amountToken),
    transaction_currency: currencyCode(currencyToken, context),
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Every currency-adjacent amount on the receipt, with its line for context.
function collectCurrencyAmounts(rawText) {
  const pattern = new RegExp(
    `(?:(${STRICT_CURRENCY_PATTERN})\\s*([-+]?\\d[\\d.,]*)|([-+]?\\d[\\d.,]*)\\s*(${STRICT_CURRENCY_PATTERN}))`,
    'gi',
  );
  const found = [];
  for (const line of receiptLines(rawText)) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      const amount = moneyNumber(match[2] || match[3]);
      if (amount === null || amount <= 0) continue;
      found.push({ amount: Math.abs(amount), currency: currencyCode(match[1] || match[4], line), line });
    }
  }
  return found;
}

// Business rule: we never record the bank/service commission — only the net
// transfer amount. So on a receipt that shows a "bonifico" transfer line, that
// is the amount; otherwise strip any "Commissioni" from the total. Returns null
// for receipts that carry neither signal, leaving them to the normal logic.
function commissionAwareAmount(rawText) {
  const entries = collectCurrencyAmounts(rawText);
  if (!entries.length) return null;
  const isCommission = (line) => /commiss/i.test(line);
  const currency = (entry) => entry?.currency || currencyFromText(rawText);

  const transfers = entries.filter((entry) => /bonific/i.test(entry.line) && !isCommission(entry.line));
  if (transfers.length) {
    const best = transfers.reduce((a, b) => (b.amount > a.amount ? b : a));
    return { amount_paid: best.amount, transaction_currency: currency(best) };
  }

  if (entries.some((entry) => isCommission(entry.line))) {
    const total = entries.reduce((a, b) => (b.amount > a.amount ? b : a));
    const commission = round2(entries
      .filter((entry) => isCommission(entry.line))
      .reduce((sum, entry) => sum + entry.amount, 0));
    if (commission > 0 && commission < total.amount) {
      const net = round2(total.amount - commission);
      const match = entries.find((entry) => !isCommission(entry.line) && Math.abs(entry.amount - net) < 0.01);
      return { amount_paid: net, transaction_currency: currency(match || total) };
    }
  }
  return null;
}

// Fallback for noisy OCR where amount labels are unreadable ("IMPORTO TOT."
// misread as "RTO TOT."). A currency symbol glued to a number is a strong,
// label-independent signal, so we take the largest such amount (the total on a
// receipt without a separate commission line).
function strongCurrencyAmount(rawText) {
  const found = collectCurrencyAmounts(rawText);
  if (!found.length) return null;
  const best = found.reduce((a, b) => (b.amount > a.amount ? b : a));
  return {
    amount_paid: best.amount,
    transaction_currency: best.currency || currencyFromText(rawText),
  };
}

function extractAmountAndCurrency(rawText, text) {
  // Net-of-commission transfer amount takes priority on receipts that show one.
  const commissionAware = commissionAwareAmount(rawText);
  if (commissionAware?.amount_paid) return commissionAware;

  const lines = receiptLines(rawText);
  const joined = lines.join(' ');
  const labelledCurrencyThenAmount = new RegExp(`(${CURRENCY_PATTERN})\\s*([-+]?\\d[\\d.,]*)\\s*(${STRICT_CURRENCY_PATTERN})?`, 'i');
  const labelledAmountThenCurrency = new RegExp(`([-+]?\\d[\\d.,]*)\\s*(${CURRENCY_PATTERN})`, 'i');
  const strictCurrencyThenAmount = new RegExp(`(${STRICT_CURRENCY_PATTERN})\\s*([-+]?\\d[\\d.,]*)\\s*(${STRICT_CURRENCY_PATTERN})?`, 'i');
  const strictAmountThenCurrency = new RegExp(`([-+]?\\d[\\d.,]*)\\s*(${STRICT_CURRENCY_PATTERN})`, 'i');

  const pairedAmount = firstMatch(joined, [
    new RegExp(`\\bdata\\s+addebito\\s+ordinante\\s+importo\\s+\\d{1,2}[-/.]\\d{1,2}[-/.]20\\d{2}\\s+([-+]?\\d[\\d.,]*\\s*(?:${STRICT_CURRENCY_PATTERN}|Euro)?)`, 'i'),
    /\ba\s+debito\s*\([^)]*\)\s+a\s+credito\s*\([^)]*\)\s+valuta\s+descrizione\s+([-+]?\d[\d.,]*)/i,
  ]);
  if (pairedAmount) {
    const parsed = moneyMatchToAmount(pairedAmount.match(labelledAmountThenCurrency)
      || pairedAmount.match(/\b([-+]?\d[\d.,]*)\b/i), pairedAmount);
    if (parsed.amount_paid) {
      return {
        amount_paid: Math.abs(parsed.amount_paid),
        transaction_currency: parsed.transaction_currency || currencyFromText(joined),
      };
    }
  }

  const amountLabels = [
    /total\s+to\s+recipient\s*[:#-]?\s*(.*)/i,
    /^(?:importo\s+bonifico|importo(?!\s+totale)|lmporto|amount\s+sent|amount)\b\s*[:#-]?\s*(.*)/i,
    /(?:a\s+debito\s*\([^)]*\)\s+a\s+credito\s*\([^)]*\)\s+valuta\s+descrizione)\s*([-+]?\d[\d.,]*)/i,
  ];
  for (const label of amountLabels) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const labelMatch = line.match(label);
      if (!labelMatch) continue;
      const value = compact(labelMatch[1]) || lines[index + 1] || line;
      const parsed = moneyMatchToAmount(value.match(labelledAmountThenCurrency)
        || value.match(labelledCurrencyThenAmount)
        || value.match(/\b([-+]?\d[\d.,]*)\b/i), line);
      if (parsed.amount_paid) {
        return {
          amount_paid: Math.abs(parsed.amount_paid),
          transaction_currency: parsed.transaction_currency || currencyFromText(joined),
        };
      }
    }
  }

  // Before falling back to grabbing arbitrary numbers, trust currency-adjacent
  // amounts (survives garbled labels far better).
  const strong = strongCurrencyAmount(rawText);
  if (strong?.amount_paid) return strong;

  const amountWindow = text.match(/\b(?:amount|paid|successfully|total|totale|importo|settled|received)\b(.{0,100})/i)?.[1] || text;
  const labelled = amountWindow.match(labelledAmountThenCurrency)
    || amountWindow.match(labelledCurrencyThenAmount)
    || (amountWindow !== text ? amountWindow.match(/\b([-+]?\d[\d.,]*)\b/i) : null);
  const fallback = text.match(strictAmountThenCurrency)
    || text.match(strictCurrencyThenAmount);
  const match = labelled || fallback;
  if (!match) {
    const colonAmount = firstMatch(joined, [
      /\b(?!UTR\b|TRN\b|CRO\b|ID\b)[A-Z][A-Z .'-]{2,80}\s*:\s*([-+]?\d[\d.,]*)\b/i,
    ]);
    if (!colonAmount) return {};
    const amount = moneyNumber(colonAmount);
    return {
      amount_paid: amount ? Math.abs(amount) : amount,
      transaction_currency: currencyFromText(joined) || 'EUR',
    };
  }

  const parsed = moneyMatchToAmount(match, amountWindow);
  return {
    amount_paid: parsed.amount_paid ? Math.abs(parsed.amount_paid) : parsed.amount_paid,
    transaction_currency: parsed.transaction_currency
      || currencyFromText(joined)
      || (/(\bICICI\b|\bHDFC\b|\bSBI\b|\bAXIS\b|\bSavings\s+a\/c\b|\bUPI\b)/i.test(text) ? 'INR' : ''),
  };
}

function currencyFromText(text) {
  const value = String(text || '');
  const divisa = value.match(/\b(?:divisa|currency)\s*[:#-]?\s*(EUR|INR|USD|GBP)\b/i);
  if (divisa) return divisa[1].toUpperCase();
  if (new RegExp(STRICT_CURRENCY_PATTERN, 'i').test(value)) {
    const token = value.match(new RegExp(STRICT_CURRENCY_PATTERN, 'i'))?.[0];
    return currencyCode(token, value);
  }
  return '';
}

function cleanPartyName(value) {
  return compact(value)
    .replace(/^INTER\d+[A-Z0-9]*\s+/i, '')
    .replace(/\b(?:bank|account|iban|bic|date|data|amount|importo|total|totale|transaction|txn|utr|trn|rrn|stan|beneficiary|beneficiario|dati|codice|commissioni|comunicazioni|saluti|paid\s+at|tr\.?\s*id)\b.*$/i, '')
    .trim();
}

function cleanFreeText(value) {
  return compact(value).replace(/\s+\b(?:saluti|postepay|poste italiane)\b.*$/i, '').trim();
}

function extractTransferDate(rawText, text) {
  const lines = receiptLines(rawText);
  const lineText = lines.join(' ');
  const cityDate = firstMatch(lineText, [
    /\bmilano,\s*(\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i,
  ]);
  if (cityDate) return parseDayMonthYear(cityDate) || parseDate(cityDate);

  const italianDate = firstMatch(text, [
    /\b(?:effettuato|eseguito)\s+il\s+giorno\s*[:#-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i,
  ]);
  if (italianDate) return parseDayMonthYear(italianDate) || parseDate(italianDate);

  const italianLabelDate = firstMatch(lineText, [
    /\b(?:data\s+odierna|data\s+creazione|data\s+inserimento(?:\s+disposizione)?|data\s+esecuzione|data\s+di\s+addebito|data\s+addebito\s+ordinante|data\s+regolamento\s+beneficiario|milano,|autorizzato\s+in\s+data)(?:\s+\w+){0,3}\s*[:#-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i,
    /\bin\s+data\s+(\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\s+abbiamo/i,
  ]);
  if (italianLabelDate) return parseDayMonthYear(italianLabelDate) || parseDate(italianLabelDate);

  const paidAtDate = firstMatch(lineText, [
    /\bpaid\s+at\b.{0,60}?(\d{1,2}\s+[A-Za-z]{3,9}\s+'?\d{2,4})/i,
  ]);
  if (paidAtDate) return parseDate(paidAtDate);

  const submittedDate = firstMatch(lineText, [
    /\b(?:submitted|available)\s*[:#-]?\s*(\d{1,2}\s+[A-Za-z]{3,9},?\s+20\d{2})/i,
  ]);
  if (submittedDate) return parseDate(submittedDate);

  const labelled = firstMatch(text, [
    /\b(?:transaction|payment|transfer|date|data)\s*(?:date)?\s*[:#-]?\s*((?:20\d{2}|\d{1,2})[-/.]\d{1,2}[-/.](?:20\d{2}|\d{1,2}))/i,
  ]);
  return parseDate(labelled) || parseDate(text);
}

function extractValueDate(rawText, text) {
  const lineText = receiptLines(rawText).join(' ');
  const labelled = firstMatch(lineText || text, [
    /\bdata\s+valuta(?:\s+\w+)?\s*[:#-]?\s*((?:20\d{2})[-/.]\d{1,2}[-/.]\d{1,2}(?:T[0-9:.Z+-]+)?|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i,
    /\bvalue\s+date\s*[:#-]?\s*((?:20\d{2})[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i,
  ]);
  return parseDayMonthYear(labelled) || parseDate(labelled);
}

function extractSenderAccount(rawText, text) {
  const lineText = receiptLines(rawText).join(' ');
  return firstMatch(text, [
    new RegExp(`\\bdati\\s+ordinante\\b.{0,140}?\\biban\\s*[:#-]?\\s*(${IBAN_PATTERN})`, 'i'),
    new RegExp(`\\bordinante\\b.{0,220}?\\biban(?:\\s+carta\\s+postepay\\s+di\\s+addebito)?\\s*[:#-]?\\s*(${IBAN_PATTERN})`, 'i'),
    new RegExp(`\\b(?:sender|payer|from|customer)\\b.{0,160}?\\biban\\s*[:#-]?\\s*(${IBAN_PATTERN})`, 'i'),
    new RegExp(`\\b(?:account|iban)\\s*(?:no\\.?|number|id)?\\s*[:#-]?\\s*(${IBAN_PATTERN})`, 'i'),
    /\bfrom\b.{0,180}?(?:[\u2022*xX]{2,}\s*|ending\s+)(\d{3,6})\s*(?:savings|current|a\/c|account)\b/i,
    /\b(?:bank|account)\b.{0,80}?[\u2022*xX]{2,}\s*(\d{3,6})\b/i,
    /\b(?:bank account|account)\s*(?:account\s+)?ending\s+in\s+(\d{3,6})\b/i,
    /\bn\.\s*c\/c\s+(\d{2,}\/\d{2,})\b/i,
    /\bno\.\s+rapporto\s*[:#-]?\s*(\d{4,})\b/i,
  ]) || firstMatch(lineText, [
    new RegExp(`\\bdati\\s+ordinante\\b.{0,180}?\\biban\\s*(${IBAN_PATTERN})`, 'i'),
    /\b(?:account)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9*]{4,34})/i,
  ]);
}

function nextLineAfter(lines, labelPattern) {
  const index = lines.findIndex((line) => labelPattern.test(line));
  return index >= 0 ? lines[index + 1] || '' : '';
}

function extractSenderName(rawText, text) {
  const lines = receiptLines(rawText);
  const lineText = lines.join(' ');
  const sender = cleanPartyName(firstMatch(text, [
    /\bordinante\s+iban\b.{0,180}?\bintestazione\s*[:#-]?\s*([A-Z][A-Z0-9 .,'&-]{2,100}?)(?=\s+\b(?:eseguito|riferimento|beneficiario)\b|$)/i,
    /\bordinante\b.{0,260}?\bintestazione\s*[:#-]?\s*([A-Z][A-Z0-9 .,'&-]{2,100}?)(?=\s+\b(?:beneficiario|beneficiary|iban|bic|dati|codice|data|importo|commissioni|totale|comunicazioni|saluti)\b|$)/i,
    /\bordinante\s*[:#-]\s*([A-Z][A-Z0-9 .,'&-]{2,120}?)(?=\s+\b(?:estremi|causale|importo|divisa|data|cro|tipo|beneficiario|conto|banca)\b|$)/i,
    /\bdati\s+ordinante\b.{0,220}?\bdi\s+([A-Z][A-Z0-9 .,'&-]{2,120}?)(?=\s+\b(?:dati\s+beneficiari|beneficiario|iban|codice|banca|quasi|data)\b|$)/i,
    /\boperazione\s+effettuata\s+da\s+([A-Z][A-Z0-9 .,'&-]{2,100}?)(?=\s+\b(?:n\.\s*c\/c|filiale|beneficiario|indirizzo)\b|$)/i,
    /\bfrom\s+([A-Z][A-Za-z .'-]{2,80}?)(?=\s+\b(?:ICICI|HDFC|SBI|AXIS|Bank|Paid\s+at|Tr\.?\s*ID|Savings|Current|A\/c)\b|$)/i,
    /\b(?:sender|payer|from|customer)\s*(?:name)?\s*[:#-]?\s*([A-Z][A-Z0-9 .,'&-]{2,80}?)(?=\s+\b(?:account|iban|date|amount|total|transaction|txn|utr|trn|rrn|stan)\b|$)/i,
  ]));
  if (sender) return sender;

  const remitlySender = nextLineAfter(lines, /^sender$/i);
  if (remitlySender && !/recipient|payment details/i.test(remitlySender)) return cleanPartyName(remitlySender);

  const ordinanteLine = nextLineAfter(lines, /^ordinante$/i);
  if (ordinanteLine && !/iban|data|rapporto|beneficiario/i.test(ordinanteLine)) return cleanPartyName(ordinanteLine);

  const lineSender = cleanPartyName(firstMatch(lineText, [
    /\bordinante\s+([A-Z][A-Z0-9 .,'&-]{2,120}?)(?=\s+\b(?:cro|id|beneficiario|rapporto|causale|importo|divisa|data)\b|$)/i,
  ]));
  return lineSender;
}

function extractReference(rawText, text) {
  const lineText = receiptLines(rawText).join(' ');
  const value = firstMatch(lineText, [
    // Mooney / bank "TRN" is the transfer reference; prefer it over a TID
    // (terminal id) that may sit lower on the same receipt.
    /\bTRN\s*[:#.-]?\s*(\d{12,}[A-Z0-9]*)/i,
    /\bNumero\s+prenotazione\s+(\d{5,})\b/i,
    /\bID\s*[:#-]\s*([A-Z0-9][A-Z0-9 /-]{3,}?)(?=\s+\b(?:BENEF|BENEFICIARIO|TIPO|DATA|CAUSALE|IMPORTO|DIVISA|BANCA|DELIVERY|HTTPS)\b|\s+\(\*\)|$)/i,
    /\bTRN\s+Data\s+regolamento\s+beneficiario\s+([A-Z0-9][A-Z0-9/-]{6,})\s+\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}\b/i,
    /\b(?:transaction\s+reference|txn\s+reference|utr|rrn|stan|tid|auth(?:orization)?\s+code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 /-]{3,}?)(?=\s+\b(?:SENDER|PAYER|FROM|CUSTOMER|ACCOUNT|IBAN|DATE|DATA|AMOUNT|TOTAL|TRANSACTION|TXN|UTR|TRN|RRN|STAN|TID)\b|\s+\d{1,2}(?:[-/.]\d{1,2}|\s+[A-Za-z])|$)/i,
    /\b(?:CRO\/ID\s+operazione\*{0,2}|CRO\/TRN|CRO\/ID|CRO|TRN|TID|RIF\.\s*OP\.?|ID\s+operazione|ID\s+transazione\s*\(CRO\)|Reference\s+No\.?|Codice\s+riferimento|Codice\s+operazione)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 /-]{3,}?)(?=\s+\b(?:BENEF|BENEFICIARIO|TIPO|DATA|CAUSALE|IMPORTO|DIVISA|BANCA|DELIVERY|HTTPS|BENEFICIARY|SALUTI)\b|\s+\d{1,2}(?:[-/.]\d{1,2}|\s+[A-Za-z])|\s+\(\*\)|$)/i,
    /\btr\.\s*(?:id|no|ref)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 /-]{3,}?)(?=\s+\b(?:BENEF|BENEFICIARIO|TIPO|DATA|CAUSALE|IMPORTO|DIVISA|BANCA|DELIVERY|HTTPS)\b|\s+\d{1,2}(?:[-/.]\d{1,2}|\s+[A-Za-z])|$)/i,
    /\b([A-Z]{2,}\d{6,}[A-Z0-9]*)\b/,
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  ]) || firstMatch(text, [
    /\b(?:transaction|txn|payment|bank|gateway)\s*(?:id|ref(?:erence)?|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{4,})/i,
  ]);

  const reference = compact(value).replace(/Beneficiary.*$/i, '').replace(/\s+/g, '');
  return /\d/.test(reference) ? reference : '';
}

function extractSenderBankName(rawText, text) {
  const lineText = receiptLines(rawText).join(' ');
  const source = lineText || text;

  // The sender's bank is what debited the payment. On PostePay confirmations the
  // sender debits a Postepay card, so the sender bank is PostePay — not the
  // beneficiary's "denominazione della banca" (our receiving bank) named lower down.
  if (/\bcarta\s+postepay\s+di\s+addebito\b/i.test(source) || /\bpostepay\b/i.test(source)) {
    return 'PostePay';
  }

  return cleanFreeText(firstMatch(source, [
    // Explicit sender-bank labels take priority over any beneficiary bank on the receipt.
    /\b(?:banca\s+ordinante|banca\s+mittente|sender bank|from bank)\s*[:#-]?\s*(.{2,90}?)(?=\s+\b(?:account|iban|date|amount|total|transaction|reference|remarks|narrative|beneficiario|filiale)\b|$)/i,
    // Indian sender receipts name the debiting account's own bank.
    /\b(ICICI\s+Bank\s+Limited)\b/i,
    /\b(HDFC\s+Bank|Axis\s+Bank|State\s+Bank\s+of\s+India|Kotak\s+Mahindra\s+Bank|SBI)\b/i,
    /\bBank\s+(ICICI\s+Bank)\b/i,
    /\b(ICICI\s+Bank)\b/i,
  ]));
}

function extractNarrative(rawText, text) {
  const lineText = receiptLines(rawText).join(' ');
  return cleanFreeText(firstMatch(lineText || text, [
    /\bcomunicazioni\s+al\s+beneficiario\s*[:#-]?\s*(.{2,140}?)(?=\s+\b(?:saluti|postepay|poste|codice|data|importo|commissioni|totale)\b|$)/i,
    /\bcausale(?:\s+pagamento)?\s*[:#-]?\s*(.{2,140}?)(?=\s+\b(?:data|stato|ordinante|beneficiario|cro|id|tipo|commissioni|importo|iban|attenzione|https)\b|$)/i,
    /\b(?:description|narrative|remarks|purpose|memo)\s*[:#-]?\s*(.{2,140}?)(?=\s+\b(?:date|amount|total|transaction|reference)\b|$)/i,
    /\bto\s+(.{2,120}?)(?=\s+\b(?:ICICI\s+Bank|HDFC\s+Bank|Axis\s+Bank|From|Paid\s+at|Tr\.?\s*ID)\b|$)/i,
  ]));
}

export function parsePaymentProofText(rawText) {
  const text = compact(rawText);
  const method = detectMethod(text);
  const amount = extractAmountAndCurrency(rawText, text);
  const transferDate = extractTransferDate(rawText, text);
  const valueDate = extractValueDate(rawText, text);
  const transactionRef = extractReference(rawText, text);
  const payer = extractSenderName(rawText, text);
  const account = extractSenderAccount(rawText, text);
  const bankName = extractSenderBankName(rawText, text);
  const bankDescription = extractNarrative(rawText, text);

  const extracted = {
    ...amount,
    payment_method: method,
    payment_date: transferDate,
    bank_transaction_reference: method === 'BANK_TRANSFER' ? transactionRef : '',
    upi_transaction_id: method === 'UPI' ? transactionRef : '',
    pos_transaction_reference: method === 'POS_TERMINAL' ? transactionRef : '',
    gateway_transaction_id: method === 'ONLINE_PAYMENT' ? transactionRef : '',
    cheque_number: method === 'CHEQUE' ? transactionRef : '',
    bank_party_name: method === 'BANK_TRANSFER' ? payer : '',
    bank_transaction_date: method === 'BANK_TRANSFER' ? transferDate : '',
    value_date: method === 'BANK_TRANSFER' ? valueDate || transferDate : '',
    bank_name: method === 'BANK_TRANSFER' ? bankName : '',
    bank_description: method === 'BANK_TRANSFER' ? bankDescription : '',
    upi_party_name: method === 'UPI' ? payer : '',
    payer_name: method === 'ONLINE_PAYMENT' ? payer : '',
    external_account_reference: method === 'BANK_TRANSFER' ? account : '',
  };

  const warnings = [];
  if (!text) warnings.push('NO_TEXT');
  if (!extracted.amount_paid) warnings.push('AMOUNT_NOT_FOUND');
  if (!transactionRef) warnings.push('REFERENCE_NOT_FOUND');
  if (!method) warnings.push('METHOD_NOT_DETECTED');

  return {
    parser_version: PAYMENT_PROOF_PARSER_VERSION,
    raw_text: rawText || '',
    extracted,
    warnings,
    confidence: Math.max(0, 100 - warnings.length * 20),
    status: text ? 'EXTRACTED' : 'NO_TEXT',
  };
}

export function mergePaymentProofDraft(form, extracted = {}, options = {}) {
  const next = { ...form };
  const protectedFields = new Set(options.protectedFields || []);
  const overwriteFields = new Set(options.overwriteFields || []);

  Object.entries(extracted).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (key === 'amount_paid' && Number(value) <= 0) return;
    if (protectedFields.has(key)) return;
    if (overwriteFields.has(key) || next[key] === undefined || next[key] === null || String(next[key]).trim() === '') {
      next[key] = key === 'amount_paid' ? String(value) : value;
    }
  });
  if (extracted.payment_method && !protectedFields.has('payment_method')) {
    next.payment_method = extracted.payment_method;
  }
  if (extracted.transaction_currency && !protectedFields.has('transaction_currency')) {
    next.transaction_currency = extracted.transaction_currency;
  }
  const defaultPaymentDate = new Date().toISOString().split('T')[0];
  if (extracted.payment_date && !protectedFields.has('payment_date')
    && (!form.payment_date || form.payment_date === defaultPaymentDate)) {
    next.payment_date = extracted.payment_date;
  }
  return next;
}
