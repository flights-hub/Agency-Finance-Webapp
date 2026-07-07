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

## Checks

```bash
npm run lint
npm run build
```
