// Imported only by the explicitly ephemeral UI demo, never by the production app.
import { hashPassword } from '../src/auth/password.js';
import type { SqlClient } from '../src/database/database.service.js';
export async function seedAdminUi(sql: SqlClient, password: string) {
  const hash = await hashPassword(password);
  const user = (
    await sql.query<{ id: string }>(
      "INSERT INTO users(email,username,role) VALUES('admin@example.test','Demo Admin','admin') RETURNING id",
    )
  ).rows[0]!;
  await sql.query('INSERT INTO admin_credentials(user_id,email,password_hash) VALUES($1,$2,$3)', [
    user.id,
    'admin@example.test',
    hash,
  ]);
  await sql.query(`INSERT INTO design_requests(number,guest_hash,idempotency_key,request_hash,selection,contact)
    SELECT 'DEMO-REQUEST',repeat('a',64),gen_random_uuid(),repeat('b',64),
    jsonb_build_array(jsonb_build_object('id',id,'category','glass','name',name)),
    '{"recipientName":"Khách thử nghiệm","phone":"0900000000","area":"Thủ Đức","note":"Dữ liệu demo trong bộ nhớ"}'::jsonb
    FROM materials WHERE legacy_id='cubic-square'`);
  const material = (
    await sql.query<{ id: string }>("SELECT id FROM materials WHERE legacy_id='cubic-square'")
  ).rows[0]!;
  const snapshot = {
    kind: 'product',
    currency: 'VND',
    items: [
      {
        id: material.id,
        name: 'Bể demo',
        unit: 'bể',
        quantity: 1,
        unitPriceVnd: 200000,
        lineTotalVnd: 200000,
      },
    ],
    subtotalVnd: 200000,
    labourVnd: 0,
    totalVnd: 200000,
    depositVnd: 100000,
    policyRevision: 1,
    shippingMode: 'separate',
    deliveryAreaCodes: ['HCM'],
    shippingFeeVnd: null,
    fulfillment: 'delivery',
  };
  const contact = {
    recipientName: 'Khách thử nghiệm',
    phone: '0900000000',
    fulfillment: 'delivery',
    address: 'Địa chỉ demo',
    deliveryAreaCode: 'HCM',
    note: 'Dữ liệu demo trong bộ nhớ',
  };
  const quote = (
    await sql.query<{ id: string }>(
      "INSERT INTO quotes(user_id,snapshot,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING id",
      [user.id, JSON.stringify(snapshot)],
    )
  ).rows[0]!;
  const order = (
    await sql.query<{ id: string }>(
      "INSERT INTO orders(user_id,quote_id,number,idempotency_key,request_hash,snapshot,contact,status) VALUES($1,$2,'DEMO-ORDER',gen_random_uuid(),repeat('c',64),$3,$4,'awaiting_payment') RETURNING id",
      [user.id, quote.id, JSON.stringify(snapshot), JSON.stringify(contact)],
    )
  ).rows[0]!;
  await sql.query("INSERT INTO invoices(order_id,number,snapshot) VALUES($1,'INV-DEMO',$2)", [
    order.id,
    JSON.stringify({ ...snapshot, contact, documentType: 'order_summary' }),
  ]);
}
