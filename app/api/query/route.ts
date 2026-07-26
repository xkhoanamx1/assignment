import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';

type OrderRow = {
  order_date: string;
  delivery_date: string;
  status: string;
  carrier: string;
  origin_city: string;
  destination_city: string;
  order_value_usd: number;
};

type AnalyticsResult = {
  answer: string;
  explanation: string;
  suggested_chart: string;
  filters: Record<string, string | number | boolean>;
  data: Array<Record<string, unknown>>;
};

function parseCsv(content: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentValue);
      if (currentRow.some((value) => value.trim())) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue);
    if (currentRow.some((value) => value.trim())) {
      rows.push(currentRow);
    }
  }

  return rows;
}

async function loadOrders(): Promise<OrderRow[]> {
  const candidates = [
    path.join(process.cwd(), 'data', 'mock_logistics_data.csv'),
    path.join(process.cwd(), 'mock_logistics_data.csv'),
    path.join(process.cwd(), '..', 'data', 'mock_logistics_data.csv'),
    path.join(process.cwd(), '..', 'mock_logistics_data.csv'),
    path.join(process.cwd(), 'app', 'api', 'query', 'mock_logistics_data.csv')
  ];

  let content = '';
  for (const candidate of candidates) {
    try {
      content = await fs.readFile(candidate, 'utf8');
      break;
    } catch {
      // continue to next candidate
    }
  }

  if (!content) {
    throw new Error('Unable to locate mock_logistics_data.csv in the deployed environment.');
  }

  const rows = parseCsv(content);
  const headers = rows[0] || [];

  return rows.slice(1).map((row) => {
    const record: Record<string, string | number> = {};
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
      order_value_usd: Number(record.order_value_usd || 0)
    };
  });
}

function isVietnamese(text: string) {
  return /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđĐ]/.test(text);
}

function getLastMonthsOrders(orders: OrderRow[], months = 3) {
  const latestDate = orders.reduce((latest, order) => {
    const current = new Date(order.order_date);
    return current > latest ? current : latest;
  }, new Date(0));

  const cutoff = new Date(latestDate);
  cutoff.setMonth(cutoff.getMonth() - months);

  return orders.filter((order) => new Date(order.order_date) >= cutoff);
}

function getWeekKey(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return `${date.getFullYear()}-W${Math.ceil((diff + 1) / 7)}`;
}

function buildDelayedByWeekResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders).filter((order) => order.status === 'delayed');
  const grouped = new Map<string, number>();

  filtered.forEach((order) => {
    const key = getWeekKey(new Date(order.order_date));
    grouped.set(key, (grouped.get(key) || 0) + 1);
  });

  const data = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, delayed_orders]) => ({ week, delayed_orders }));

  const peak = data.reduce((max, current) => (current.delayed_orders > max.delayed_orders ? current : max), data[0] || { week: 'N/A', delayed_orders: 0 });

  return {
    answer: locale === 'vi'
      ? `Trong 3 tháng gần nhất có ${filtered.length} đơn hàng bị trễ. Tuần cao nhất là ${peak.week} với ${peak.delayed_orders} đơn.`
      : `There are ${filtered.length} delayed orders in the last 3 months. The peak week is ${peak.week} with ${peak.delayed_orders} delays.`,
    explanation: locale === 'vi'
      ? 'Biểu đồ này nhóm số đơn bị trễ theo tuần để thấy xu hướng và đỉnh điểm.'
      : 'This chart groups delayed orders by week so you can see the trend and weekly peaks.',
    suggested_chart: 'Bar chart',
    filters: { time_range: 'last_3_months', status: 'delayed', group_by: 'week' },
    data
  };
}

function buildCarrierDelayResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const stats = new Map<string, { total: number; delayed: number }>();

  filtered.forEach((order) => {
    const entry = stats.get(order.carrier) || { total: 0, delayed: 0 };
    entry.total += 1;
    if (order.status === 'delayed') {
      entry.delayed += 1;
    }
    stats.set(order.carrier, entry);
  });

  const data = Array.from(stats.entries())
    .map(([carrier, value]) => ({
      carrier,
      total_orders: value.total,
      delayed_orders: value.delayed,
      delay_rate: Number(((value.delayed / value.total) * 100).toFixed(1))
    }))
    .sort((a, b) => Number(b.delay_rate) - Number(a.delay_rate))
    .slice(0, 5);

  const top = data[0];

  return {
    answer: locale === 'vi'
      ? `Hãng vận chuyển có tỷ lệ trễ cao nhất là ${top?.carrier || 'N/A'} với ${top?.delay_rate || 0}% trong 3 tháng gần nhất.`
      : `The carrier with the highest delay rate is ${top?.carrier || 'N/A'} at ${top?.delay_rate || 0}% over the last 3 months.`,
    explanation: locale === 'vi'
      ? 'Tỷ lệ trễ được tính bằng số đơn bị trễ chia cho tổng số đơn của từng hãng.'
      : 'Delay rate is calculated as delayed orders divided by total orders for each carrier.',
    suggested_chart: 'Bar chart',
    filters: { time_range: 'last_3_months', metric: 'delay_rate', group_by: 'carrier' },
    data
  };
}

function buildRouteCostResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const routeTotals = new Map<string, number>();

  filtered.forEach((order) => {
    const route = `${order.origin_city} → ${order.destination_city}`;
    routeTotals.set(route, (routeTotals.get(route) || 0) + order.order_value_usd);
  });

  const data = Array.from(routeTotals.entries())
    .map(([route, total_order_value_usd]) => ({ route, total_order_value_usd: Number(total_order_value_usd.toFixed(2)) }))
    .sort((a, b) => Number(b.total_order_value_usd) - Number(a.total_order_value_usd))
    .slice(0, 5);

  const top = data[0];

  return {
    answer: locale === 'vi'
      ? `Tuyến có tổng giá trị đơn hàng cao nhất là ${top?.route || 'N/A'} với ${top?.total_order_value_usd || 0} USD.`
      : `The route with the highest total order value is ${top?.route || 'N/A'} at ${top?.total_order_value_usd || 0} USD.`,
    explanation: locale === 'vi'
      ? 'Tuyến này được tính dựa trên tổng giá trị đơn hàng từ dữ liệu CSV thực tế.'
      : 'This route is ranked by the sum of order value from the actual CSV data.',
    suggested_chart: 'Bar chart',
    filters: { time_range: 'last_3_months', metric: 'order_value_usd', group_by: 'route' },
    data
  };
}

function buildSummaryResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const total = filtered.length;
  const delivered = filtered.filter((order) => order.status === 'delivered').length;
  const delayed = filtered.filter((order) => order.status === 'delayed').length;
  const onTimeRate = total ? Number(((delivered / total) * 100).toFixed(1)) : 0;

  return {
    answer: locale === 'vi'
      ? `Trong 3 tháng gần nhất có ${total} đơn hàng, ${delivered} đơn giao thành công, ${delayed} đơn bị trễ, tỷ lệ đúng hẹn ${onTimeRate}%.`
      : `In the last 3 months there are ${total} orders, ${delivered} delivered, ${delayed} delayed, with an on-time rate of ${onTimeRate}%.`,
    explanation: locale === 'vi'
      ? 'Tóm tắt này được tính trực tiếp từ dữ liệu CSV thực tế.'
      : 'This summary is computed directly from the real CSV dataset.',
    suggested_chart: 'Bar chart',
    filters: { time_range: 'last_3_months', metric: 'order_status' },
    data: [
      { status: 'delivered', count: delivered },
      { status: 'delayed', count: delayed }
    ]
  };
}

function buildAnalyticsResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const q = question.toLowerCase();

  if (/(delay|delayed|trễ|trễ hẹn|late)/i.test(q) && /(week|tuần)/i.test(q)) {
    return buildDelayedByWeekResult(question, orders);
  }

  if (/(carrier|hãng|shipper|vendor)/i.test(q) && /(delay|delayed|trễ|late)/i.test(q)) {
    return buildCarrierDelayResult(question, orders);
  }

  if (/(cost|chi phí|value|giá trị|route|tuyến)/i.test(q) && /(highest|cao nhất|top|max)/i.test(q)) {
    return buildRouteCostResult(question, orders);
  }

  return buildSummaryResult(question, orders);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ question: '' }));
  const { question } = body;

  try {
    const orders = await loadOrders();
    const result = buildAnalyticsResult(question, orders);

    return Response.json({ ok: true, provider: 'csv', result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected analytics error.'
      },
      { status: 500 }
    );
  }
}
