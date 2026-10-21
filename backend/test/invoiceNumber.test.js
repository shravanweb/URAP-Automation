import { describe, expect, it } from 'vitest';
import { extractFields } from '../src/automation/documents/extraction.js';

const inv = (text) => extractFields(text, { documentType: 'invoice' }).values.invoiceNumber;

describe('invoice number label variants and layouts', () => {
  it.each([
    ['Invoice No: INV-1001', 'INV-1001'],
    ['Invoice No.: 2024/118', '2024/118'],
    ['Invoice #: 4471', '4471'],
    ['Invoice # : ABC 20250101001', 'ABC 20250101001'],
    ['Inv. No. A-77', 'A-77'],
    ['Invoice Number - INV - 2025', 'INV-2025'],
    ['Invoice ID: 99812', '99812'],
    ['Bill #: B12', 'B12'],
    ['INVOICE NO.\nINV-55', 'INV-55'],
  ])('%j -> %s', (text, expected) => {
    expect(inv(`Acme Ltd\n${text}\nTotal: $10.00`)).toBe(expected);
  });

  it('handles an unmapped glyph (control char) between prefix and number', () => {
    expect(inv('Invoice #  :  ABC \u0000 20250101001\nDate : 01/02/2025')).toBe('ABC 20250101001');
  });

  it('does not take a following label word as a prefix', () => {
    const result = extractFields('Invoice\nInvoice Date 01/02/2025\nTotal: 5.00', { documentType: 'invoice' });
    expect(result.values.invoiceNumber).toBeNull();
  });

  it('leaves absent PO, GSTIN and tax null', () => {
    const { values } = extractFields('Acme\nInvoice No: X-1\nDate: 01/02/2025\nTotal Amount: $5.00', { documentType: 'invoice' });
    expect(values.poNumber).toBeNull();
    expect(values.vendorGstin).toBeNull();
    expect(values.taxAmount).toBeNull();
  });
});
