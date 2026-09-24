import { describe, expect, it } from 'vitest';
import {
  LEGACY_ROUTE_REDIRECTS,
  ROUTES,
  currentReturnContext,
  entityHref,
  moduleForPath,
  safeReturnTo,
} from './navigation';

describe('canonical navigation metadata', () => {
  it('resolves search and notification entities to their canonical detail or workspace', () => {
    expect(entityHref({ type: 'project', id: 'p1' })).toBe('/projects/p1');
    expect(entityHref({ type: 'equipment', id: 'e1', system_id: 's1' })).toBe('/systems/s1');
    expect(entityHref({ type: 'equipment', id: 'e1' })).toBe(ROUTES.projects);
    expect(entityHref({ type: 'purchase_order', id: 'po1' })).toBe('/purchase-orders/po1');
    expect(entityHref({ type: 'design_book', id: 'db1' })).toBe('/design-books/db1');
  });

  it('uses one access module for every route in a hierarchy', () => {
    expect(moduleForPath('/products/masters/123')).toBe('pim');
    expect(moduleForPath('/purchase-orders/123')).toBe('orders');
    expect(moduleForPath('/design-books/123')).toBe('design_books');
    expect(moduleForPath('/enquiries/123')).toBe('business_development');
  });

  it('preserves filtered origins but rejects unsafe return locations', () => {
    expect(currentReturnContext('/purchase-orders', '?status=po_review', 'Purchase Orders')).toEqual({
      returnTo: '/purchase-orders?status=po_review',
      returnLabel: 'Purchase Orders',
    });
    expect(safeReturnTo('/order-management?queue=released', '/purchase-orders')).toBe('/order-management?queue=released');
    expect(safeReturnTo('//example.com', '/purchase-orders')).toBe('/purchase-orders');
    expect(safeReturnTo('https://example.com', '/purchase-orders')).toBe('/purchase-orders');
  });

  it('keeps all legacy redirects pointed at a canonical route', () => {
    expect(LEGACY_ROUTE_REDIRECTS).toEqual(expect.arrayContaining([
      { from: '/orders', to: ROUTES.orders },
      { from: '/procurement', to: ROUTES.purchaseOrders },
      { from: '/design-book-engine/books', to: ROUTES.designBooks },
    ]));
  });
});