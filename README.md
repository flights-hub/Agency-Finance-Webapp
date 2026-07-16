# Agency Finance Webapp

Finance office dashboard for FlyForSure agency operations.

## Features

- Booking ledger with invoice, passenger, PNR, sector, fare, balance, instalment, ticket status, alert, and refund fields.
- Manual booking entry, cryptic text parsing, and PDF upload parsing.
- Payment, refund, expense, alert, statement, and settings tables using the same dense ledger table design.
- R2-backed payment proof evidence with local OCR prefill and verification metadata.
- Storefront-inspired ledger calculations for payment status, profit, balance due, days to departure, refund exposure, and alerts.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts the Node API on port `8787` and Vite on port `5173`.
Create a `.env` from `.env.example`, run the Supabase SQL files in `supabase/`
including `07_payment_proof_ocr.sql`, then manually create the first Supabase
Auth admin user and insert a matching `profiles` row with role `ADMIN`.

## On-device OCR (PP-OCRv5 + ONNX)

Payment proofs are read locally in the browser by a PP-OCRv5 pipeline that runs
entirely in a Web Worker (`public/ocr/ppocrv5/worker.js`) using ONNX Runtime
Web — no image bytes are sent to a third-party OCR service. Until the model
binaries are provisioned the app cleanly falls back to Tesseract, so OCR always
works; PP-OCRv5 just improves accuracy and speed.

To enable PP-OCRv5:

```bash
npm install                 # pulls in onnxruntime-web
npm run ocr:setup           # copies the runtime + wires the manifest
```

`ocr:setup` copies ONNX Runtime Web into `public/ocr/onnxruntime-web/` and looks
for the PP-OCRv5 models in `public/ocr/ppocrv5/` (`det.onnx`, `rec.onnx`,
`cls.onnx`, `ppocr_keys_v1.txt`). Provide the models either by dropping the
files in, or by pointing the script at download URLs:

```bash
OCR_DET_URL=https://…/det.onnx \
OCR_REC_URL=https://…/rec.onnx \
OCR_CLS_URL=https://…/cls.onnx \
OCR_DICT_URL=https://…/ppocr_keys_v1.txt \
npm run ocr:setup
```

The models and runtime binaries are gitignored (large); the script sets
`manifest.enabled` to `true` only once every required asset is present.

## Checks

```bash
npm run lint
npm run build
```
