const DAY = 86_400_000;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

export function reportRange(from, to) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Selecciona fechas válidas.');
    const ms = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2100-12-31') invalid('Usa fechas válidas entre 2000 y 2100.');
    return ms;
  };
  const first = parse(from), last = parse(to);
  const days = (last - first) / DAY + 1;
  if (days < 1) invalid('La fecha inicial debe ser anterior o igual a la final.');
  if (days > 3660) invalid('Selecciona un período de hasta 10 años.');
  // Bogotá is UTC-5 year round. The upper bound excludes the next local day.
  const start = new Date(first + 5 * 3_600_000).toISOString();
  const end = new Date(last + DAY + 5 * 3_600_000).toISOString();
  return { from, to, days, start, end, previousStart: new Date(Date.parse(start) - days * DAY).toISOString(), previousEnd: start };
}

export async function salesReport(db, from, to) {
  const range = reportRange(from, to);
  const args = [range.start, range.end];
  const summary = (await db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) sales,
    COALESCE(SUM(CASE WHEN status='Pagada' THEN total ELSE 0 END),0) settled,
    COALESCE(SUM(CASE WHEN status='Pendiente' THEN total ELSE 0 END),0) pending,
    COUNT(DISTINCT user_id) customers FROM invoices WHERE created>=? AND created<?`).get(...args));
  summary.units = (await db.prepare(`SELECT COALESCE(SUM(l.quantity),0) units FROM invoice_lines l
    JOIN invoices i ON i.id=l.invoice_id WHERE i.created>=? AND i.created<?`).get(...args)).units;
  summary.average = summary.orders ? Math.round(summary.sales / summary.orders) : 0;
  const previous = (await db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) sales FROM invoices WHERE created>=? AND created<?`).get(range.previousStart, range.previousEnd));
  const change = summary.sales - previous.sales;
  const comparison = { ...previous, change, percent: previous.sales ? Math.round(change / previous.sales * 1000) / 10 : null };
  const products = (await db.prepare(`SELECT l.product_id id, p.name, c.name category, c.type,
    SUM(l.quantity) units, SUM(l.quantity*l.price) sales FROM invoice_lines l
    JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id
    JOIN categories c ON c.id=p.category_id WHERE i.created>=? AND i.created<?
    GROUP BY l.product_id,p.name,c.name,c.type ORDER BY units DESC, sales DESC, l.product_id`).all(...args));
  const categories = (await db.prepare(`SELECT c.id, c.name, c.type, SUM(l.quantity) units,
    SUM(l.quantity*l.price) sales FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
    JOIN products p ON p.id=l.product_id JOIN categories c ON c.id=p.category_id
    WHERE i.created>=? AND i.created<? GROUP BY c.id ORDER BY sales DESC, c.id`).all(...args));
  const monthly = range.days > 62;
  const daily = (await db.prepare(`SELECT strftime('${monthly ? '%Y-%m' : '%Y-%m-%d'}',created,'-5 hours') period,
    SUM(total) sales, COUNT(*) orders FROM invoices WHERE created>=? AND created<?
    GROUP BY period ORDER BY period`).all(...args));
  const values = new Map(daily.map(row => [row.period, row]));
  const trend = [];
  const cursor = new Date(from + 'T00:00:00Z');
  if (monthly) cursor.setUTCDate(1);
  while (cursor.toISOString().slice(0, 10) <= to) {
    const key = cursor.toISOString().slice(0, monthly ? 7 : 10);
    trend.push(values.get(key) || { period: key, sales: 0, orders: 0 });
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const stock = (await db.prepare(`SELECT p.id,p.name,p.stock,p.minimum FROM products p
    WHERE p.active=1 AND p.stock<=p.minimum ORDER BY p.stock,p.id`).all());
  const noSales = (await db.prepare(`SELECT p.id,p.name,p.stock FROM products p WHERE p.active=1 AND NOT EXISTS
    (SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
    WHERE l.product_id=p.id AND i.created>=? AND i.created<?) ORDER BY p.name`).all(...args));
  return { range: { from, to, days: range.days }, summary, comparison, products, categories,
    trend, granularity: monthly ? 'month' : 'day', stock, noSales };
}

export async function monthlyAccounts(db, month, person = '') {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) invalid('Selecciona un mes válido.');
  const first = month + '-01';
  const end = new Date(first + 'T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const range = reportRange(first, end.toISOString().slice(0,10));
  if (person && (!/^\d+$/.test(person) || !(await db.prepare('SELECT id FROM users WHERE id=?').get(Number(person))))) invalid('Selecciona una persona válida.');
  const args = [range.start, range.end, ...(person ? [Number(person)] : [])];
  const people = (await db.prepare(`SELECT u.id,u.name,u.email,COUNT(i.id) orders,COALESCE(SUM(i.total),0) total,
    COALESCE(SUM(CASE WHEN i.status='Pendiente' THEN i.total ELSE 0 END),0) pending,
    COALESCE(SUM(CASE WHEN i.status='Pagada' THEN i.total ELSE 0 END),0) settled
    FROM users u LEFT JOIN invoices i ON i.user_id=u.id AND i.created>=? AND i.created<?
    ${person?'WHERE u.id=?':''} GROUP BY u.id HAVING u.role='consumer' OR COUNT(i.id)>0 ORDER BY u.name,u.id`).all(...args));
  const invoices = (await db.prepare(`SELECT i.*,u.name consumer,u.email FROM invoices i JOIN users u ON u.id=i.user_id
    WHERE i.created>=? AND i.created<? ${person?'AND u.id=?':''} ORDER BY u.name,i.created,i.id`).all(...args));
  const lines = (await db.prepare(`SELECT l.*,i.user_id,i.created,i.status,u.name consumer,u.email FROM invoice_lines l
    JOIN invoices i ON i.id=l.invoice_id JOIN users u ON u.id=i.user_id
    WHERE i.created>=? AND i.created<? ${person?'AND u.id=?':''} ORDER BY u.name,i.id,l.id`).all(...args));
  const totals = people.reduce((s,p)=>({ orders:s.orders+p.orders,total:s.total+p.total,pending:s.pending+p.pending,settled:s.settled+p.settled }), {orders:0,total:0,pending:0,settled:0});
  return { month, person:person?Number(person):null, range:{from:first,to:range.to}, totals, people, invoices, lines };
}
