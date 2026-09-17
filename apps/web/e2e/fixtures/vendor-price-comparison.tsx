import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  calculateVendorComparison,
  MostCompetitiveBadge,
  VendorComparisonNotice,
} from '../../src/pages/products/VendorPriceComparison';
import { VendorOption } from '../../src/types';
import '../../src/index.css';

const vendors = [
  { id: 'tie-a', vendor_name: 'Tie A', vendor_item_code: 'TIED-10', unit_price: 100, currency: 'USD', approved_status: 'Approved' },
  { id: 'tie-b', vendor_name: 'Tie B', vendor_item_code: 'tied-10', unit_price: 100, currency: 'USD', approved_status: 'Approved' },
  { id: 'approved-higher', vendor_name: 'Approved Higher', vendor_item_code: 'TIED-10', unit_price: 125, currency: 'USD', approved_status: 'Approved' },
  { id: 'rejected-cheap', vendor_name: 'Rejected Cheap', vendor_item_code: 'TIED-10', unit_price: 1, currency: 'USD', approved_status: 'Rejected' },
  { id: 'missing-usd', vendor_name: 'USD Quote', vendor_item_code: 'NO-RATE', unit_price: 50, currency: 'USD', approved_status: 'Approved' },
  { id: 'missing-eur', vendor_name: 'EUR Quote', vendor_item_code: 'NO-RATE', unit_price: 40, currency: 'EUR', approved_status: 'Approved' },
] as VendorOption[];

function Fixture() {
  const comparison = calculateVendorComparison(vendors, []);
  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-bold">Vendor options</h1>
      <div role="alert" className="mb-3">
        <VendorComparisonNotice itemCodes={comparison.incomparableCodes} />
      </div>
      <table>
        <tbody>
          {vendors.map(vendor => (
            <tr key={vendor.id}>
              <th className="pr-4 text-left">{vendor.vendor_name}</th>
              <td>{comparison.competitiveIds.has(vendor.id) && <MostCompetitiveBadge />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);