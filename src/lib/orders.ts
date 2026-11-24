/** Order history and receipts: GET /me/orders, GET /orders/:id, refund requests. */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { MyOrder, Order, RefundRequestStatus } from './types';

type Tone = 'plain' | 'accent' | 'success' | 'warning';

export function useMyOrders(userId: string | undefined) {
  return useQuery({ queryKey: ['me', 'orders', userId], queryFn: () => api<{ orders: MyOrder[] }>('/me/orders'), enabled: !!userId, staleTime: 30_000 });
}

/**
 * One order with its refund requests. The email lets orders bought as a guest with the same email open too
 * (the API checks it against the order).
 */
export function useOrder(id: string | undefined, email: string | undefined) {
  return useQuery({
    queryKey: ['me', 'order', id, email],
    queryFn: () => api<Order>(`/orders/${encodeURIComponent(id!)}${email ? `?email=${encodeURIComponent(email)}` : ''}`),
    enabled: !!id && !!email,
    staleTime: 15_000,
  });
}

export function orderStatus(s: Order['status']): { label: string; tone: Tone } {
  switch (s) {
    case 'PAID':
      return { label: 'Paid', tone: 'success' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'plain' };
    case 'PARTIALLY_REFUNDED':
      return { label: 'Partly refunded', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'accent' };
    default:
      return { label: 'Payment pending', tone: 'warning' };
  }
}

export function refundStatus(s: RefundRequestStatus): { short: string; title: string; body: string; tone: Tone } {
  switch (s) {
    case 'OPEN':
      return { short: 'Refund requested', title: 'Refund requested', body: 'Our team is looking at your request. The decision shows here.', tone: 'warning' };
    case 'APPROVED':
      return { short: 'Refund approved', title: 'Refund approved', body: 'The money goes back to how you paid. It can take a few days to show on your statement.', tone: 'success' };
    case 'PARTIAL':
      return { short: 'Part refunded', title: 'Partly refunded', body: 'Part of this order was refunded to how you paid. It can take a few days to show on your statement.', tone: 'success' };
    default:
      return { short: 'Refund declined', title: 'Refund request declined', body: 'This order wasn’t eligible for a refund. You can still resell or transfer the tickets from My tickets.', tone: 'plain' };
  }
}

export const providerLabel = (p: string) => ({ mock: 'Test payment (nothing charged)', stripe: 'Card', paystack: 'Paystack' })[p] ?? p;

export const REFUND_REASON_MIN = 10;
export const REFUND_REASON_MAX = 1000;
