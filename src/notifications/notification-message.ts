import type { QuoteSnapshot } from '../orders/orders.service.js';
import type { MailMessage } from './mailgun.js';

type Contact = { recipientName: string; phone: string; note?: string };
export type OrderEmailData = {
  id: string;
  number: string;
  status: string;
  snapshot: QuoteSnapshot;
  contact: Contact & { fulfillment: string; address?: string; deliveryAreaCode?: string };
};
export type DesignRequestEmailData = {
  number: string;
  selection: { name: string; sizeLabel?: string | null }[];
  contact: Contact & { area: string; preferredDate?: string };
};
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`;

export function orderMessage(order: OrderEmailData, adminUrl: string | null): MailMessage {
  const { contact, snapshot } = order;
  return {
    subject: `[Petite Terre] Đơn hàng mới ${order.number}`,
    text: [
      `Đơn hàng mới: ${order.number}`,
      `Loại: ${snapshot.kind === 'custom' ? 'Làm theo yêu cầu' : 'Bể bán sẵn'}`,
      `Khách: ${contact.recipientName}`,
      `Điện thoại: ${contact.phone}`,
      `Nhận hàng: ${contact.fulfillment === 'pickup' ? 'Tại cửa hàng' : 'Giao hàng'}`,
      ...(contact.fulfillment === 'delivery'
        ? [`Địa chỉ: ${contact.address ?? ''}`, `Khu vực: ${contact.deliveryAreaCode ?? ''}`]
        : []),
      '',
      ...snapshot.items.map(
        (item) =>
          `- ${item.name}${item.sizeLabel ? ` (${item.sizeLabel})` : ''} × ${item.quantity}: ${money(item.lineTotalVnd)}`,
      ),
      '',
      `Tổng sản phẩm và công: ${money(snapshot.totalVnd)}`,
      `Mức đặt cọc yêu cầu: ${money(snapshot.depositVnd)}`,
      `Phí giao hàng: ${snapshot.shippingFeeVnd === null ? 'Chưa xác định, tính riêng' : money(snapshot.shippingFeeVnd)}`,
      'Đây là thông báo tạo đơn, không xác nhận khách đã thanh toán. Kiểm tra trạng thái hiện tại trong admin.',
      `Ghi chú: ${contact.note || 'Không có'}`,
      ...(adminUrl ? ['', `Xem đơn: ${adminUrl}/orders/${order.id}`] : []),
    ].join('\n'),
  };
}

export function designRequestMessage(
  request: DesignRequestEmailData,
  adminUrl: string | null,
): MailMessage {
  return {
    subject: `[Petite Terre] Yêu cầu tư vấn mới ${request.number}`,
    text: [
      `Yêu cầu tư vấn mới: ${request.number}`,
      `Khách: ${request.contact.recipientName}`,
      `Điện thoại: ${request.contact.phone}`,
      `Khu vực: ${request.contact.area}`,
      `Ngày mong muốn: ${request.contact.preferredDate || 'Chưa chọn'}`,
      '',
      ...request.selection.map(
        (item) => `- ${item.name}${item.sizeLabel ? ` (${item.sizeLabel})` : ''}`,
      ),
      '',
      `Ghi chú: ${request.contact.note || 'Không có'}`,
      'Đây là yêu cầu tư vấn, chưa phải đơn hàng đã chốt giá hoặc xác nhận thanh toán.',
      ...(adminUrl
        ? ['', `Xem yêu cầu trong admin: ${adminUrl}/requests`, `Tìm mã: ${request.number}`]
        : []),
    ].join('\n'),
  };
}
