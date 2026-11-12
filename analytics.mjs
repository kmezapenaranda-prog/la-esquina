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
    COALESCE(SUM((SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=invoices.id)),0) settled,
    COALESCE(SUM(total-(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=invoices.id)),0) pending,
    COUNT(DISTINCT user_id) customers FROM invoices WHERE created>=? AND created<?`).get(...args));
  summary.units = (await db.prepare(`SELECT COALESCE(SUM(l.quantity-l.returned_quantity),0) units FROM invoice_lines l
    JOIN invoices i ON i.id=l.invoice_id WHERE i.created>=? AND i.created<?`).get(...args)).units;
  summary.average = summary.orders ? Math.round(summary.sales / summary.orders) : 0;
  const previous = (await db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) sales FROM invoices WHERE created>=? AND created<?`).get(range.previousStart, range.previousEnd));
  const change = summary.sales - previous.sales;
  const comparison = { ...previous, change, percent: previous.sales ? Math.round(change / previous.sales * 1000) / 10 : null };
  const products = (await db.prepare(`SELECT l.product_id id, p.name,
    SUM(l.quantity-l.returned_quantity) units, SUM((CAST(l.quantity-l.returned_quantity AS BIGINT))*l.price) sales,
    SUM(CASE WHEN l.unit_cost IS NOT NULL THEN (CAST(l.quantity-l.returned_quantity AS BIGINT))*(l.price-l.unit_cost) ELSE 0 END) real_profit,
    SUM(CASE WHEN l.unit_cost IS NOT NULL THEN (CAST(l.quantity-l.returned_quantity AS BIGINT))*l.unit_cost ELSE 0 END) known_cost,
    SUM(CASE WHEN l.unit_cost IS NULL THEN l.quantity-l.returned_quantity ELSE 0 END) unknown_units FROM invoice_lines l
    JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id
    WHERE i.created>=? AND i.created<?
    GROUP BY l.product_id,p.name HAVING SUM(l.quantity-l.returned_quantity)>0 ORDER BY units DESC, sales DESC, l.product_id`).all(...args));
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
    WHERE l.product_id=p.id AND l.quantity>l.returned_quantity AND i.created>=? AND i.created<?) ORDER BY p.name`).all(...args));
  // Fixed gross margin on revenue, not a markup on purchase cost.
  const margin = 0.30;
  for (const product of products) {
    product.estimatedProfit = Math.round(product.sales * margin);
    product.estimatedProfitPerUnit = Math.round(product.sales * margin / product.units);
  }
  summary.realProfit = products.reduce((sum,p)=>sum+p.real_profit,0);
  summary.knownCost = products.reduce((sum,p)=>sum+p.known_cost,0);
  summary.unknownUnits = products.reduce((sum,p)=>sum+p.unknown_units,0);
  const lossValues=await db.prepare('SELECT COALESCE(SUM(CASE WHEN unit_cost IS NOT NULL THEN CAST(quantity AS BIGINT)*unit_cost ELSE 0 END),0) cost,COALESCE(SUM(CASE WHEN unit_cost IS NULL THEN quantity ELSE 0 END),0) unknown_units FROM losses WHERE created>=? AND created<?').get(...args);
  summary.lossCost=lossValues.cost;summary.lossUnknownUnits=lossValues.unknown_units;
  summary.estimatedProfit = products.reduce((sum, p) => sum + p.estimatedProfit, 0);
  const inventory = await db.prepare('SELECT id,name,price,stock,unit_cost,minimum FROM products WHERE active=1 ORDER BY name,id').all();
  const sold = new Map(products.map(p => [p.id, p]));
  const inventoryProducts = inventory.map(p => ({ ...p, units: sold.get(p.id)?.units || 0,
    estimatedProfitPerUnit: Math.round(p.price * margin),
    potentialProfit: Math.round(p.price * p.stock * margin),
    actualProfitPerUnit: p.unit_cost===null?null:p.price-p.unit_cost,
    actualPotentialProfit: p.unit_cost===null?null:(p.price-p.unit_cost)*p.stock,
    dailyDemand:(sold.get(p.id)?.units||0)/range.days,
    stockDays:sold.get(p.id)?.units?Math.round(p.stock/(sold.get(p.id).units/range.days)*10)/10:null,
    suggestedQuantity:Math.max(0,Math.ceil((sold.get(p.id)?.units||0)/range.days*14)-p.stock) }));
  const lowSales = inventoryProducts.filter(p => p.stock > 0 && p.units <= range.days / 7)
    .sort((a,b) => a.units-b.units || b.stock-a.stock || a.id-b.id);
  const insights = { bestSellers: products.filter(p => p.units === products[0]?.units), lowSales,
    weeklyThreshold: 1, shortPeriod: range.days < 7, coverageDays:14, replenishment:inventoryProducts.filter(p=>p.suggestedQuantity>0).sort((a,b)=>(a.stockDays??Infinity)-(b.stockDays??Infinity)||a.id-b.id) };
  const inventorySummary = { products: inventoryProducts,
    saleValue: inventoryProducts.reduce((sum,p) => sum+p.price*p.stock,0),
    potentialProfit: inventoryProducts.reduce((sum,p) => sum+p.potentialProfit,0),actualPotentialProfit:inventoryProducts.reduce((sum,p)=>sum+(p.actualPotentialProfit??0),0),unknownCostProducts:inventoryProducts.filter(p=>p.unit_cost===null&&p.stock>0).length };
  return { range: { from, to, days: range.days }, summary, comparison, products,
    margin, insights, inventory: inventorySummary, trend, granularity: monthly ? 'month' : 'day', stock, noSales };
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
    COALESCE(SUM(i.total-(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) pending,
    COALESCE(SUM((SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) settled
    FROM users u LEFT JOIN invoices i ON i.user_id=u.id AND i.created>=? AND i.created<?
    ${person?'WHERE u.id=?':''} GROUP BY u.id HAVING u.role='consumer' OR COUNT(i.id)>0 ORDER BY u.name,u.id`).all(...args));
  const invoices = (await db.prepare(`SELECT i.*,(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id) paid,u.name consumer,u.email FROM invoices i JOIN users u ON u.id=i.user_id
    WHERE i.created>=? AND i.created<? ${person?'AND u.id=?':''} ORDER BY u.name,i.created,i.id`).all(...args));
  const lines = (await db.prepare(`SELECT l.*,i.user_id,i.created,i.status,u.name consumer,u.email FROM invoice_lines l
    JOIN invoices i ON i.id=l.invoice_id JOIN users u ON u.id=i.user_id
    WHERE i.created>=? AND i.created<? ${person?'AND u.id=?':''} ORDER BY u.name,i.id,l.id`).all(...args));
  const totals = people.reduce((s,p)=>({ orders:s.orders+p.orders,total:s.total+p.total,pending:s.pending+p.pending,settled:s.settled+p.settled }), {orders:0,total:0,pending:0,settled:0});
  return { month, person:person?Number(person):null, range:{from:first,to:range.to}, totals, people, invoices, lines };
}
