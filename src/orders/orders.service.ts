import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import type { SqlClient } from '../database/database.service.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { decodeTimeCursor } from '../common/pagination.js';
import type { PageQuery } from '../common/pagination.js';
import type {
  CreateOrderDto,
  CreateQuoteDto,
  OrderStatusDto,
  PricingDto,
  RecordPaymentDto,
} from './orders.dto.js';

export type Policy = {
  labour_bps: number | null;
  deposit_bps: number | null;
  quantity_mode: 'per_selection' | 'quantity' | null;
  shipping_mode: 'separate' | 'pickup' | null;
  delivery_area_codes: string[];
  revision: number;
};
export type QuoteSnapshot = {
  kind: 'custom' | 'product';
  currency: 'VND';
  items: {
    id: string;
    name: string;
    unit: string;
    quantity: number;
    unitPriceVnd: number;
    lineTotalVnd: number;
    revision?: number;
  }[];
  subtotalVnd: number;
  labourVnd: number;
  totalVnd: number;
  depositVnd: number;
  policyRevision: number;
  shippingMode: 'separate' | 'pickup';
  deliveryAreaCodes: string[];
  shippingFeeVnd: null | number;
};
const checkedMoney = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new BadRequestException('Amount outside supported integer range');
  return value;
};
const sqlCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : null;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CatalogRepository) private readonly catalog: CatalogRepository,
  ) {}
  private async policy(client: SqlClient = this.db.client) {
    const policy = (
      await client.query<Policy>('SELECT * FROM pricing_policy WHERE singleton FOR SHARE')
    ).rows[0];
    if (
      !policy ||
      policy.labour_bps === null ||
      policy.deposit_bps === null ||
      !policy.quantity_mode ||
      !policy.shipping_mode
    )
      throw new ServiceUnavailableException('Pricing policy is not configured');
    return policy as Policy & {
      labour_bps: number;
      deposit_bps: number;
      quantity_mode: 'per_selection' | 'quantity';
      shipping_mode: 'separate' | 'pickup';
    };
  }
  async quote(userId: string, input: CreateQuoteDto) {
    const policy = await this.policy();
    let items: QuoteSnapshot['items'];
    if (input.kind === 'custom') {
      if (input.productId !== undefined || input.quantity !== undefined)
        throw new BadRequestException('Product fields are not valid for a custom quote');
      const ids = input.items!.map((item) => item.materialId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate materials');
      const [categories, materials] = await Promise.all([
        this.catalog.categories(),
        this.catalog.selectedMaterials(ids),
      ]);
      if (materials.length !== ids.length)
        throw new BadRequestException('Selected material not published');
      for (const category of categories) {
        const count = materials.filter((item) => item.category === category.code).length;
        if (
          count < category.minSelections ||
          (category.maxSelections !== null && count > category.maxSelections)
        )
          throw new UnprocessableEntityException(`Selection limit for ${category.code}`);
      }
      items = materials.map((material) => {
        const quantity = input.items!.find((item) => item.materialId === material.id)!.quantity;
        if (policy.quantity_mode === 'per_selection' && quantity !== 1)
          throw new BadRequestException('Each selected material must have quantity 1');
        if (material.priceVnd === null || !material.unit || material.availability !== 'available')
          throw new UnprocessableEntityException('Material price or availability is not confirmed');
        return {
          id: material.id,
          name: material.name,
          unit: material.unit,
          quantity,
          unitPriceVnd: material.priceVnd,
          lineTotalVnd: checkedMoney(material.priceVnd * quantity),
          revision: material.revision,
        };
      });
    } else {
      if (input.items !== undefined)
        throw new BadRequestException('Material fields are not valid for a product quote');
      const result = await this.db.query<{
        id: string;
        name: string;
        price_vnd: number | null;
        availability: string;
        revision: number;
      }>('SELECT id,name,price_vnd,availability,revision FROM products WHERE id=$1 AND published', [
        input.productId,
      ]);
      const product = result.rows[0];
      if (!product || product.price_vnd === null || product.availability !== 'available')
        throw new UnprocessableEntityException('Product price or availability is not confirmed');
      items = [
        {
          id: product.id,
          name: product.name,
          revision: product.revision,
          unit: 'product',
          quantity: input.quantity!,
          unitPriceVnd: product.price_vnd,
          lineTotalVnd: checkedMoney(product.price_vnd * input.quantity!),
        },
      ];
    }
    const subtotalVnd = checkedMoney(items.reduce((sum, item) => sum + item.lineTotalVnd, 0));
    // Round fractions of a dong up, consistently for labour and deposit.
    const labourVnd =
      input.kind === 'custom'
        ? checkedMoney(Number((BigInt(subtotalVnd) * BigInt(policy.labour_bps) + 9999n) / 10000n))
        : 0;
    const totalVnd = checkedMoney(subtotalVnd + labourVnd);
    const snapshot: QuoteSnapshot = {
      kind: input.kind,
      currency: 'VND',
      items,
      subtotalVnd,
      labourVnd,
      totalVnd,
      depositVnd: Number((BigInt(totalVnd) * BigInt(policy.deposit_bps) + 9999n) / 10000n),
      policyRevision: policy.revision,
      shippingMode: policy.shipping_mode,
      deliveryAreaCodes: policy.delivery_area_codes,
      shippingFeeVnd: policy.shipping_mode === 'pickup' ? 0 : null,
    };
    const result = await this.db.query<{ id: string; expiresAt: Date }>(
      `INSERT INTO quotes(user_id,snapshot,expires_at) VALUES($1,$2::jsonb,now()+interval '15 minutes') RETURNING id,expires_at AS "expiresAt"`,
      [userId, JSON.stringify(snapshot)],
    );
    return { ...result.rows[0], ...snapshot };
  }
  async order(userId: string, key: string, input: CreateOrderDto) {
    const contact = {
      recipientName: input.recipientName,
      phone: input.phone,
      fulfillment: input.fulfillment,
      address: input.fulfillment === 'delivery' ? input.address : null,
      deliveryAreaCode: input.fulfillment === 'delivery' ? input.deliveryAreaCode : null,
      note: input.note ?? '',
    };
    const hash = createHash('sha256')
      .update(JSON.stringify({ quoteId: input.quoteId, ...contact }))
      .digest('hex');
    try {
      return await this.db.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${userId}:${key}`]);
        const replay = (
          await client.query(
            'SELECT id,number,status,request_hash AS "requestHash" FROM orders WHERE user_id=$1 AND idempotency_key=$2',
            [userId, key],
          )
        ).rows[0];
        if (replay) {
          if (replay.requestHash !== hash)
            throw new ConflictException('Idempotency key already used with different data');
          return { id: replay.id, number: replay.number, status: replay.status };
        }
        const quote = (
          await client.query<{ snapshot: QuoteSnapshot; expired: boolean }>(
            'SELECT snapshot,expires_at<=now() AS expired FROM quotes WHERE id=$1 AND user_id=$2 FOR UPDATE',
            [input.quoteId, userId],
          )
        ).rows[0];
        if (!quote) throw new NotFoundException('Quote not found');
        if (quote.expired) throw new ConflictException('Quote expired; request a new quote');
        const snapshot = quote.snapshot;
        const policy = await this.policy(client);
        if (policy.revision !== snapshot.policyRevision)
          throw new ConflictException('Pricing policy changed; request a new quote');
        if (
          input.fulfillment === 'delivery' &&
          (snapshot.shippingMode === 'pickup' ||
            !snapshot.deliveryAreaCodes.includes(input.deliveryAreaCode!))
        )
          throw new UnprocessableEntityException('Delivery area not supported');
        const ids = snapshot.items.map((item) => item.id);
        if (snapshot.kind === 'custom') {
          const rows = (
            await client.query<{
              id: string;
              revision: number;
              price_vnd: number;
              availability: string;
            }>(
              'SELECT m.id,m.revision,m.price_vnd,m.availability FROM materials m JOIN material_categories c ON c.id=m.category_id WHERE m.id=ANY($1::uuid[]) AND m.published AND c.active ORDER BY m.id FOR SHARE OF m,c',
              [ids],
            )
          ).rows;
          if (
            rows.length !== ids.length ||
            rows.some((row) => {
              const item = snapshot.items.find((item) => item.id === row.id)!;
              return (
                row.revision !== item.revision ||
                row.price_vnd !== item.unitPriceVnd ||
                row.availability !== 'available'
              );
            })
          )
            throw new ConflictException('Catalog changed; request a new quote');
          const categories = (
            await client.query<{
              code: string;
              min_selections: number;
              max_selections: number | null;
            }>(
              'SELECT code,min_selections,max_selections FROM material_categories WHERE active ORDER BY code FOR SHARE',
            )
          ).rows;
          const categoryItems = (
            await client.query<{ category: string }>(
              'SELECT c.code AS category FROM materials m JOIN material_categories c ON c.id=m.category_id WHERE m.id=ANY($1::uuid[])',
              [ids],
            )
          ).rows;
          if (
            categories.some((category) => {
              const count = categoryItems.filter((item) => item.category === category.code).length;
              return (
                count < category.min_selections ||
                (category.max_selections !== null && count > category.max_selections)
              );
            })
          )
            throw new ConflictException('Selection rules changed; request a new quote');
        } else {
          const row = (
            await client.query<{ price_vnd: number; availability: string; revision: number }>(
              'SELECT price_vnd,availability,revision FROM products WHERE id=$1 AND published FOR SHARE',
              [ids[0]],
            )
          ).rows[0];
          if (
            !row ||
            row.price_vnd !== snapshot.items[0]!.unitPriceVnd ||
            row.revision !== snapshot.items[0]!.revision ||
            row.availability !== 'available'
          )
            throw new ConflictException('Product changed; request a new quote');
        }
        const number = `TR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
        const stored = {
          ...snapshot,
          shippingFeeVnd: input.fulfillment === 'pickup' ? 0 : null,
          fulfillment: input.fulfillment,
        };
        const order = (
          await client.query<{ id: string; number: string; status: string }>(
            `INSERT INTO orders(user_id,quote_id,number,idempotency_key,request_hash,snapshot,contact,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING id,number,status`,
            [
              userId,
              input.quoteId,
              number,
              key,
              hash,
              JSON.stringify(stored),
              JSON.stringify(contact),
              snapshot.depositVnd === 0 ? 'confirmed' : 'awaiting_payment',
            ],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO invoices(order_id,number,snapshot) VALUES($1,$2,$3::jsonb)`,
          [
            order.id,
            `INV-${number}`,
            JSON.stringify({
              orderNumber: number,
              contact,
              ...stored,
              documentType: 'order_summary',
            }),
          ],
        );
        return order;
      });
    } catch (error) {
      if (sqlCode(error) === '23505')
        throw new ConflictException('Quote already ordered or idempotency key already used');
      throw error;
    }
  }
  async list(userId: string | null, query: PageQuery) {
    const cursor = decodeTimeCursor(query.cursor);
    const rows = (
      await this.db.query<{
        id: string;
        number: string;
        status: string;
        createdAt: Date;
        cursorCreatedAt: string;
      }>(
        `SELECT id,number,status,created_at AS "createdAt",created_at::text AS "cursorCreatedAt" FROM orders WHERE ($1::uuid IS NULL OR user_id=$1) AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`,
        [userId, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      )
    ).rows;
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    const items = pageRows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      createdAt: row.createdAt,
    }));
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ createdAt: last.cursorCreatedAt, id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }
  async pricingInfo() {
    const policy = (await this.db.query<Policy>('SELECT * FROM pricing_policy WHERE singleton'))
      .rows[0]!;
    return {
      configured:
        policy.labour_bps !== null &&
        policy.deposit_bps !== null &&
        policy.quantity_mode !== null &&
        policy.shipping_mode !== null,
      labourBps: policy.labour_bps,
      depositBps: policy.deposit_bps,
      quantityMode: policy.quantity_mode,
      shippingMode: policy.shipping_mode,
      deliveryAreaCodes: policy.delivery_area_codes,
      revision: policy.revision,
      currency: 'VND',
    };
  }
  async get(userId: string | null, id: string) {
    const order = (
      await this.db.query(
        'SELECT id,number,status,snapshot,contact,paid_vnd::text AS "paidVnd",created_at AS "createdAt" FROM orders WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2)',
        [id, userId],
      )
    ).rows[0];
    if (!order) throw new NotFoundException('Order not found');
    return { ...order, paidVnd: checkedMoney(Number(order.paidVnd)) };
  }
  async invoice(userId: string | null, id: string) {
    const invoice = (
      await this.db.query(
        `SELECT i.id,i.number,i.snapshot,i.created_at AS "createdAt",o.status AS "orderStatus",o.paid_vnd::text AS "paidVnd" FROM invoices i JOIN orders o ON o.id=i.order_id WHERE o.id=$1 AND ($2::uuid IS NULL OR o.user_id=$2)`,
        [id, userId],
      )
    ).rows[0];
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { ...invoice, paidVnd: checkedMoney(Number(invoice.paidVnd)) };
  }
  async pricing(input: PricingDto, actor: string, revision: number) {
    return this.db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE pricing_policy SET labour_bps=$1,deposit_bps=$2,quantity_mode=$3,shipping_mode=$4,delivery_area_codes=$5,revision=revision+1,updated_at=now() WHERE singleton AND revision=$6 RETURNING revision`,
        [
          input.labourBps,
          input.depositBps,
          input.quantityMode,
          input.shippingMode,
          input.deliveryAreaCodes,
          revision,
        ],
      );
      if (!result.rows[0])
        throw new ConflictException('Pricing revision changed; reload before editing');
      await client.query(
        `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,'pricing.updated','00000000-0000-4000-8000-000000000000',$2::jsonb)`,
        [actor, JSON.stringify(input)],
      );
      return result.rows[0];
    });
  }
  async payment(id: string, input: RecordPaymentDto, actor: string) {
    try {
      return await this.db.transaction(async (client) => {
        const order = (
          await client.query<{ snapshot: QuoteSnapshot; paid_vnd: string; status: string }>(
            'SELECT snapshot,paid_vnd,status FROM orders WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!order) throw new NotFoundException('Order not found');
        const previous = (
          await client.query(
            'SELECT id,order_id,amount_vnd::text AS amount FROM payments WHERE reference=$1',
            [input.reference],
          )
        ).rows[0];
        if (previous) {
          if (previous.order_id !== id || Number(previous.amount) !== input.amountVnd)
            throw new ConflictException('Payment reference already used');
          return { recorded: true, replayed: true };
        }
        if (order.status === 'cancelled') throw new ConflictException('Order cancelled');
        const paid = checkedMoney(Number(order.paid_vnd) + input.amountVnd);
        if (paid > order.snapshot.totalVnd)
          throw new UnprocessableEntityException(
            'Payment exceeds the order amount; reconcile separately',
          );
        await client.query(
          'INSERT INTO payments(order_id,amount_vnd,reference,confirmed_by) VALUES($1,$2,$3,$4)',
          [id, input.amountVnd, input.reference, actor],
        );
        await client.query(
          `UPDATE orders SET paid_vnd=$2,status=CASE WHEN status='awaiting_payment' AND $2>=($3::bigint) THEN 'confirmed' ELSE status END,updated_at=now() WHERE id=$1`,
          [id, paid, order.snapshot.depositVnd],
        );
        await client.query(
          `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,'payment.confirmed',$2,$3::jsonb)`,
          [actor, id, JSON.stringify(input)],
        );
        return { recorded: true, paidVnd: paid };
      });
    } catch (error) {
      if (sqlCode(error) === '23505') throw new ConflictException('Payment reference already used');
      throw error;
    }
  }
  async status(id: string, input: OrderStatusDto, actor: string) {
    return this.db.transaction(async (client) => {
      const order = (
        await client.query<{ status: string; paid_vnd: string; snapshot: QuoteSnapshot }>(
          'SELECT status,paid_vnd,snapshot FROM orders WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!order) throw new NotFoundException('Order not found');
      const allowed: Record<string, string[]> = {
        awaiting_payment: ['cancelled'],
        confirmed: ['building', 'cancelled'],
        building: ['ready'],
        ready: ['shipping', 'completed'],
        shipping: ['completed'],
        completed: [],
        cancelled: [],
      };
      if (!allowed[order.status]?.includes(input.status))
        throw new ConflictException('Invalid order status transition');
      if (input.status === 'cancelled' && Number(order.paid_vnd) > 0)
        throw new ConflictException(
          'Paid orders require a separate refund process before cancellation',
        );
      if (input.status === 'completed' && Number(order.paid_vnd) < order.snapshot.totalVnd)
        throw new ConflictException('Order is not fully paid');
      await client.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1', [
        id,
        input.status,
      ]);
      await client.query(
        `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,'order.status_changed',$2,$3::jsonb)`,
        [actor, id, JSON.stringify(input)],
      );
      return { id, status: input.status };
    });
  }
}
