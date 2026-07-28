import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '..', 'data', 'mock_logistics_data.csv');
const content = fs.readFileSync(csvPath, 'utf8');

function parseCsv(raw) {
  const rows = [];
  let currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && raw[i + 1] === '\n') i += 1;
      currentRow.push(currentValue);
      if (currentRow.some((v) => v.trim())) rows.push(currentRow);
      currentRow = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue);
    if (currentRow.some((v) => v.trim())) rows.push(currentRow);
  }

  return rows;
}

const parsed = parseCsv(content);
const headers = parsed[0] || [];
const orders = parsed.slice(1).map((row) => {
  const record = {};
  headers.forEach((header, index) => {
    record[header] = row[index] ?? '';
  });
  return {
    order_date: String(record.order_date || ''),
    delivery_date: String(record.delivery_date || ''),
    status: String(record.status || '').toLowerCase(),
    carrier: String(record.carrier || ''),
    origin_city: String(record.origin_city || ''),
    destination_city: String(record.destination_city || ''),
    order_value_usd: Number(record.order_value_usd || 0),
    region: String(record.region || ''),
    warehouse: String(record.warehouse || ''),
    product_category: String(record.product_category || ''),
    is_promo: String(record.is_promo || '0')
  };
});

function getSafeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLastMonthsOrders(list, months = 3) {
  const validDates = list
    .map((order) => ({ order, date: getSafeDate(order.order_date) }))
    .filter((entry) => entry.date);

  if (!validDates.length) return [];

  const latestDate = validDates.reduce(
    (latest, entry) => (entry.date > latest ? entry.date : latest),
    new Date(0)
  );
  const cutoff = new Date(latestDate);
  cutoff.setMonth(cutoff.getMonth() - months);

  return validDates.filter((entry) => entry.date >= cutoff).map((entry) => entry.order);
}

function getWeekKey(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return `${date.getFullYear()}-W${Math.ceil((diff + 1) / 7)}`;
}

const filtered = getLastMonthsOrders(orders);

function delayedByWeekAnswer() {
  const delayed = filtered.filter((o) => o.status === 'delayed');
  const grouped = new Map();
  delayed.forEach((order) => {
    const key = getWeekKey(new Date(order.order_date));
    grouped.set(key, (grouped.get(key) || 0) + 1);
  });
  const data = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, delayed_orders]) => ({ week, delayed_orders }));
  const peak = data.reduce(
    (max, current) => (current.delayed_orders > max.delayed_orders ? current : max),
    data[0] || { week: 'N/A', delayed_orders: 0 }
  );
  return `There are ${delayed.length} delayed orders in the last 3 months. The peak week is ${peak.week} with ${peak.delayed_orders} delays.`;
}

function carrierDelayAnswer() {
  const stats = new Map();
  filtered.forEach((order) => {
    const entry = stats.get(order.carrier) || { total: 0, delayed: 0 };
    entry.total += 1;
    if (order.status === 'delayed') entry.delayed += 1;
    stats.set(order.carrier, entry);
  });
  const data = Array.from(stats.entries())
    .map(([carrier, value]) => ({
      carrier,
      delay_rate: Number(((value.delayed / value.total) * 100).toFixed(1))
    }))
    .sort((a, b) => b.delay_rate - a.delay_rate);
  const top = data[0];
  return `The carrier with the highest delay rate is ${top?.carrier || 'N/A'} at ${top?.delay_rate || 0}% over the last 3 months.`;
}

function routeValueAnswer() {
  const routeTotals = new Map();
  filtered.forEach((order) => {
    const route = `${order.origin_city} → ${order.destination_city}`;
    routeTotals.set(route, (routeTotals.get(route) || 0) + order.order_value_usd);
  });
  const data = Array.from(routeTotals.entries())
    .map(([route, total_order_value_usd]) => ({
      route,
      total_order_value_usd: Number(total_order_value_usd.toFixed(2))
    }))
    .sort((a, b) => b.total_order_value_usd - a.total_order_value_usd);
  const top = data[0];
  return `The route with the highest total order value is ${top?.route || 'N/A'} at ${top?.total_order_value_usd || 0} USD.`;
}

function summaryAnswer() {
  const total = filtered.length;
  const delivered = filtered.filter((o) => o.status === 'delivered').length;
  const delayed = filtered.filter((o) => o.status === 'delayed').length;
  const onTimeRate = total ? Number(((delivered / total) * 100).toFixed(1)) : 0;
  return `In the last 3 months there are ${total} orders, ${delivered} delivered, ${delayed} delayed, with an on-time rate of ${onTimeRate}%.`;
}

function lastMonthDelayedAnswer() {
  const validDates = orders
    .map((order) => ({ order, date: getSafeDate(order.order_date) }))
    .filter((entry) => entry.date);
  const latestDate = validDates.reduce(
    (latest, entry) => (entry.date > latest ? entry.date : latest),
    new Date(0)
  );
  const monthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  const lastMonth = validDates
    .filter((entry) => entry.date >= monthStart)
    .map((entry) => entry.order);
  const delayed = lastMonth.filter((o) => o.status === 'delayed').length;
  const monthLabel = `${latestDate.getFullYear()}-${String(latestDate.getMonth() + 1).padStart(2, '0')}`;
  return `In ${monthLabel} (calendar month of the latest order in the dataset), ${delayed} orders have status "delayed" (${lastMonth.length} orders placed that month).`;
}

function exceptionCountAnswer() {
  const count = filtered.filter((o) => o.status === 'exception').length;
  const noun = count === 1 ? 'order' : 'orders';
  return `In the last 3 months there are ${count} ${noun} with status "exception".`;
}

function inTransitCountAnswer() {
  const count = filtered.filter((o) => o.status === 'in_transit').length;
  return `In the last 3 months there are ${count} orders currently marked "in_transit".`;
}

function avgDeliveryDaysAnswer() {
  const deliveryDays = filtered
    .map((order) => {
      const orderDate = getSafeDate(order.order_date);
      const deliveryDate = getSafeDate(order.delivery_date);
      if (!orderDate || !deliveryDate) return null;
      return Math.max(0, Math.round((deliveryDate.getTime() - orderDate.getTime()) / 86400000));
    })
    .filter((value) => value !== null);
  const avg = deliveryDays.length
    ? Number((deliveryDays.reduce((sum, value) => sum + value, 0) / deliveryDays.length).toFixed(1))
    : 0;
  return `Average delivery time in the last 3 months is ${avg} days (order_date to delivery_date, orders with both dates).`;
}

function topRegionByOrdersAnswer() {
  const regionCounts = new Map();
  filtered.forEach((order) => {
    regionCounts.set(order.region, (regionCounts.get(order.region) || 0) + 1);
  });
  const sorted = Array.from(regionCounts.entries()).sort((a, b) => b[1] - a[1]);
  const [region, count] = sorted[0] || ['N/A', 0];
  return `The region with the most orders in the last 3 months is ${region} with ${count} orders.`;
}

function promoOrdersAnswer() {
  const promo = filtered.filter((o) => o.is_promo === '1').length;
  return `In the last 3 months, ${promo} of ${filtered.length} orders used a promotion (is_promo=1).`;
}

const testCases = [
  {
    id: 'tc-01',
    question: 'Show delayed orders by week for the last 3 months',
    expectedAnswer: delayedByWeekAnswer(),
    category: 'Diagnostic'
  },
  {
    id: 'tc-02',
    question: 'Which carrier has the highest delay rate?',
    expectedAnswer: carrierDelayAnswer(),
    category: 'Diagnostic'
  },
  {
    id: 'tc-03',
    question: 'Which route has the highest total order value in the last 3 months?',
    expectedAnswer: routeValueAnswer(),
    category: 'Descriptive'
  },
  {
    id: 'tc-04',
    question: 'Give me a summary of order status for the last 3 months',
    expectedAnswer: summaryAnswer(),
    category: 'Descriptive'
  },
  {
    id: 'tc-05',
    question: 'How many orders were delivered late last month?',
    expectedAnswer: lastMonthDelayedAnswer(),
    category: 'Diagnostic'
  },
  {
    id: 'tc-06',
    question: 'How many exception orders are in the last 3 months?',
    expectedAnswer: exceptionCountAnswer(),
    category: 'Descriptive'
  },
  {
    id: 'tc-07',
    question: 'How many in-transit orders are in the last 3 months?',
    expectedAnswer: inTransitCountAnswer(),
    category: 'Descriptive'
  },
  {
    id: 'tc-08',
    question: 'What is the average delivery time in the last 3 months?',
    expectedAnswer: avgDeliveryDaysAnswer(),
    category: 'Descriptive'
  },
  {
    id: 'tc-09',
    question: 'Which region has the most orders in the last 3 months?',
    expectedAnswer: topRegionByOrdersAnswer(),
    category: 'Descriptive'
  },
  {
    id: 'tc-10',
    question: 'How many promotional orders were placed in the last 3 months?',
    expectedAnswer: promoOrdersAnswer(),
    category: 'Descriptive'
  }
];

const outPath = path.join(__dirname, '..', 'app', 'testCases.ts');
const fileBody = `/** Auto-generated from mock_logistics_data.csv — run: node scripts/generate-test-cases.mjs */
export type LogisticsTestCase = {
  id: string;
  question: string;
  expectedAnswer: string;
  category: string;
};

export const LOGISTICS_TEST_CASES: LogisticsTestCase[] = ${JSON.stringify(testCases, null, 2)};
`;

fs.writeFileSync(outPath, fileBody, 'utf8');
console.log('Wrote', outPath);
testCases.forEach((tc) => console.log(tc.id, tc.expectedAnswer));
