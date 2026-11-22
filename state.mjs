// PostgreSQL reads the complete, role-scoped state in one round trip and one MVCC snapshot.
export async function readState(db,user){
 let data;
 if(db.dialect==='postgres'){
  data=await db.prepare(`WITH viewer AS (SELECT ?::integer uid,?::boolean admin)
   SELECT
    COALESCE((SELECT jsonb_agg(p ORDER BY p.id) FROM products p WHERE active=1),'[]') products,
    COALESCE((SELECT jsonb_agg(q ORDER BY q.id DESC) FROM (SELECT i.*,u.name consumer FROM invoices i JOIN users u ON u.id=i.user_id CROSS JOIN viewer v WHERE v.admin OR i.user_id=v.uid) q),'[]') invoices,
    COALESCE((SELECT jsonb_agg(l ORDER BY l.id) FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id CROSS JOIN viewer v WHERE v.admin OR i.user_id=v.uid),'[]') lines,
    COALESCE((SELECT jsonb_agg(q ORDER BY q.id) FROM (SELECT p.id,p.invoice_id,p.amount,p.method,p.note,p.created,p.legacy FROM payments p JOIN invoices i ON i.id=p.invoice_id CROSS JOIN viewer v WHERE v.admin OR i.user_id=v.uid) q),'[]') payments,
    COALESCE((SELECT jsonb_agg(q ORDER BY q.id DESC) FROM (SELECT m.*,p.name product,p.icon,u.name actor,c.name consumer FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id LEFT JOIN users c ON c.id=m.user_id CROSS JOIN viewer v WHERE v.admin OR m.user_id=v.uid ORDER BY m.id DESC LIMIT 200) q),'[]') movements,
    COALESCE((SELECT jsonb_agg(q ORDER BY q.id) FROM (SELECT u.id,u.name,u.email,u.role FROM users u CROSS JOIN viewer v WHERE v.admin OR u.id=v.uid) q),'[]') users`).get(user.id,user.role==='admin');
 }else{
  const scope=user.role==='admin'?'':' WHERE i.user_id=?',args=user.role==='admin'?[]:[user.id];
  data={products:await db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id').all(),
   invoices:await db.prepare('SELECT i.*,u.name consumer FROM invoices i JOIN users u ON u.id=i.user_id'+scope+' ORDER BY i.id DESC').all(...args),
   lines:await db.prepare('SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id'+scope+' ORDER BY l.id').all(...args),
   payments:await db.prepare('SELECT p.id,p.invoice_id,p.amount,p.method,p.note,p.created,p.legacy FROM payments p JOIN invoices i ON i.id=p.invoice_id'+scope+' ORDER BY p.id').all(...args),
   movements:await db.prepare(`SELECT m.*,p.name product,p.icon,u.name actor,c.name consumer FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id LEFT JOIN users c ON c.id=m.user_id ${user.role==='admin'?'':'WHERE m.user_id=?'} ORDER BY m.id DESC LIMIT 200`).all(...args),
   users:await db.prepare(`SELECT id,name,email,role FROM users ${user.role==='admin'?'':'WHERE id=?'} ORDER BY id`).all(...args)};
 }
 for(const p of data.products){delete p.category_id;if(user.role!=='admin')delete p.unit_cost}
 const invoices=new Map(data.invoices.map(i=>[i.id,Object.assign(i,{lines:[],payments:[],paid:0})]));
 for(const line of data.lines){if(user.role!=='admin')delete line.unit_cost;invoices.get(line.invoice_id)?.lines.push(line)}
 for(const payment of data.payments){const i=invoices.get(payment.invoice_id);if(i){i.payments.push(payment);i.paid+=payment.amount}}
 for(const i of data.invoices)i.balance=i.total-i.paid;
 delete data.lines;delete data.payments;
 return data;
}
