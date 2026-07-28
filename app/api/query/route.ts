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
  region: string;
  is_promo: string;
};

type AnalyticsResult = {
  answer: string;
  explanation: string;
  suggested_chart: string;
  filters: Record<string, string | number | boolean>;
  data: Array<Record<string, unknown>>;
  dashboard?: {
    summary: {
      total_orders: number;
      delivered: number;
      delayed: number;
      on_time_rate: number;
      avg_delivery_days: number;
    };
    monthly_trend: Array<Record<string, unknown>>;
    carrier_delay_rates: Array<Record<string, unknown>>;
    status_breakdown: Array<Record<string, unknown>>;
  };
  provider?: string;
  prompt_config?: {
    provider: string;
    prompt_source: string;
  };
};

const DEFAULT_PROMPT_TEMPLATE = `You are a logistics analytics assistant specialized in logistics KPI analysis over a CSV dataset.
Use ONLY the provided CSV facts and derived calculations from that data.

Rules:
1. Base every answer on the dataset. Do not invent values, carriers, routes, dates, trends, or metrics that are not supported by the CSV.
2. Prefer evidence-based analytics: compute counts, percentages, averages, trends, delays, route values, carrier performance, and other relevant metrics from the CSV.
3. For descriptive questions, provide a concise answer and explain how it was derived from the data.
4. For diagnostic questions, explain the likely pattern or cause using the available data (for example delay rate by carrier, route, or time period).
5. For forecasting or recommendation questions, give a conservative estimate and clearly state that it is based on historical patterns rather than a guaranteed prediction.
6. Always return valid JSON only. Do not wrap the response in markdown.
7. Required JSON shape:
{
  "answer": "string",
  "explanation": "string",
  "suggested_chart": "string",
  "filters": { "time_range": "string", "status": "string|null", "carrier": "string|null", "region": "string|null", "warehouse": "string|null", "metric": "string|null", "dimension": "string|null" },
  "data": ["array of objects"],
  "query_plan": "string",
  "metrics": ["array of strings"],
  "dimensions": ["array of strings"]
}
8. Make the answer specific, concise, and grounded in the CSV data.
9. Use the most relevant chart type: Bar chart, Line chart, KPI cards, Table, or Scatter plot.
10. If the question is ambiguous, choose the most likely interpretation and explain that assumption in the explanation.
`;
const DEFAULT_PROVIDER = 'rule-based';

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
      order_value_usd: Number(record.order_value_usd || 0),
      region: String(record.region || ''),
      is_promo: String(record.is_promo || '0')
    };
  });
}

function getLatestOrderMonth(orders: OrderRow[]) {
  const validDates = orders
    .map((order) => ({ order, date: getSafeDate(order.order_date) }))
    .filter((entry): entry is { order: OrderRow; date: Date } => Boolean(entry.date));

  if (!validDates.length) return null;

  const latestDate = validDates.reduce(
    (latest, entry) => (entry.date > latest ? entry.date : latest),
    new Date(0)
  );
  const monthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  const monthLabel = `${latestDate.getFullYear()}-${String(latestDate.getMonth() + 1).padStart(2, '0')}`;
  const monthOrders = validDates.filter((entry) => entry.date >= monthStart).map((entry) => entry.order);

  return { monthLabel, monthOrders };
}

function isVietnamese(text: string) {
  return /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđĐ]/.test(text);
}

function getSafeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLastMonthsOrders(orders: OrderRow[], months = 3) {
  const validDates = orders
    .map((order) => ({ order, date: getSafeDate(order.order_date) }))
    .filter((entry): entry is { order: OrderRow; date: Date } => Boolean(entry.date));

  if (!validDates.length) return [];

  const latestDate = validDates.reduce((latest, entry) => (entry.date > latest ? entry.date : latest), new Date(0));
  const cutoff = new Date(latestDate);
  cutoff.setMonth(cutoff.getMonth() - months);

  return validDates.filter((entry) => entry.date >= cutoff).map((entry) => entry.order);
}

function getWeekKey(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return `${date.getFullYear()}-W${Math.ceil((diff + 1) / 7)}`;
}

function buildDashboard(orders: OrderRow[]) {
  const filtered = getLastMonthsOrders(orders);
  const total = filtered.length;
  const delivered = filtered.filter((order) => order.status === 'delivered').length;
  const delayed = filtered.filter((order) => order.status === 'delayed').length;
  const on_time_rate = total ? Number(((delivered / total) * 100).toFixed(1)) : 0;

  const deliveryDays = filtered
    .map((order) => {
      const orderDate = getSafeDate(order.order_date);
      const deliveryDate = getSafeDate(order.delivery_date);
      if (!orderDate || !deliveryDate) return null;
      return Math.max(0, Math.round((deliveryDate.getTime() - orderDate.getTime()) / 86400000));
    })
    .filter((value): value is number => value !== null);

  const avg_delivery_days = deliveryDays.length ? Number((deliveryDays.reduce((sum, value) => sum + value, 0) / deliveryDays.length).toFixed(1)) : 0;

  const monthlyMap = new Map<string, { month: string; delivered: number; delayed: number }>();
  filtered.forEach((order) => {
    const orderDate = getSafeDate(order.order_date);
    if (!orderDate) return;
    const month = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}`;
    const entry = monthlyMap.get(month) || { month, delivered: 0, delayed: 0 };
    if (order.status === 'delivered') entry.delivered += 1;
    if (order.status === 'delayed') entry.delayed += 1;
    monthlyMap.set(month, entry);
  });

  const monthly_trend = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  const carrierStats = new Map<string, { total: number; delayed: number }>();
  filtered.forEach((order) => {
    const entry = carrierStats.get(order.carrier) || { total: 0, delayed: 0 };
    entry.total += 1;
    if (order.status === 'delayed') entry.delayed += 1;
    carrierStats.set(order.carrier, entry);
  });

  const carrier_delay_rates = Array.from(carrierStats.entries())
    .map(([carrier, value]) => ({
      carrier,
      total_orders: value.total,
      delayed_orders: value.delayed,
      delay_rate: value.total ? Number(((value.delayed / value.total) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => Number(b.delay_rate) - Number(a.delay_rate));

  const status_breakdown = [
    { status: 'delivered', count: delivered },
    { status: 'delayed', count: delayed },
    { status: 'exception', count: filtered.filter((order) => order.status === 'exception').length },
    { status: 'in_transit', count: filtered.filter((order) => order.status === 'in_transit').length }
  ];

  return {
    summary: {
      total_orders: total,
      delivered,
      delayed,
      on_time_rate,
      avg_delivery_days
    },
    monthly_trend,
    carrier_delay_rates,
    status_breakdown
  };
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

function buildLastMonthDelayedResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const monthInfo = getLatestOrderMonth(orders);

  if (!monthInfo) {
    return {
      answer: locale === 'vi' ? 'Không có dữ liệu đơn hàng hợp lệ.' : 'No valid order dates in the dataset.',
      explanation: locale === 'vi' ? 'Không thể xác định tháng gần nhất.' : 'Unable to determine the latest calendar month.',
      suggested_chart: 'KPI card',
      filters: { time_range: 'latest_month', status: 'delayed' },
      data: []
    };
  }

  const { monthLabel, monthOrders } = monthInfo;
  const delayed = monthOrders.filter((order) => order.status === 'delayed').length;

  return {
    answer:
      locale === 'vi'
        ? `Trong ${monthLabel}, có ${delayed} đơn có trạng thái "delayed" (${monthOrders.length} đơn đặt trong tháng).`
        : `In ${monthLabel} (calendar month of the latest order in the dataset), ${delayed} orders have status "delayed" (${monthOrders.length} orders placed that month).`,
    explanation:
      locale === 'vi'
        ? 'Đếm đơn có status=delayed trong tháng lịch của ngày đơn mới nhất trong CSV.'
        : 'Counts orders with status=delayed in the calendar month of the latest order_date in the CSV.',
    suggested_chart: 'KPI card',
    filters: { time_range: monthLabel, status: 'delayed', metric: 'delayed_count' },
    data: [{ month: monthLabel, delayed_orders: delayed, total_orders: monthOrders.length }]
  };
}

function buildExceptionCountResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const count = filtered.filter((order) => order.status === 'exception').length;
  const noun = count === 1 ? 'order' : 'orders';

  return {
    answer:
      locale === 'vi'
        ? `Trong 3 tháng gần nhất có ${count} đơn có trạng thái "exception".`
        : `In the last 3 months there are ${count} ${noun} with status "exception".`,
    explanation:
      locale === 'vi'
        ? 'Lọc theo order_date trong 3 tháng gần nhất và đếm status=exception.'
        : 'Filters by order_date in the last 3 months and counts status=exception.',
    suggested_chart: 'KPI card',
    filters: { time_range: 'last_3_months', status: 'exception', metric: 'order_count' },
    data: [{ status: 'exception', count }]
  };
}

function buildInTransitResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const count = filtered.filter((order) => order.status === 'in_transit').length;

  return {
    answer:
      locale === 'vi'
        ? `Trong 3 tháng gần nhất có ${count} đơn đang "in_transit".`
        : `In the last 3 months there are ${count} orders currently marked "in_transit".`,
    explanation:
      locale === 'vi'
        ? 'Lọc theo order_date trong 3 tháng gần nhất và đếm status=in_transit.'
        : 'Filters by order_date in the last 3 months and counts status=in_transit.',
    suggested_chart: 'KPI card',
    filters: { time_range: 'last_3_months', status: 'in_transit', metric: 'order_count' },
    data: [{ status: 'in_transit', count }]
  };
}

function buildAvgDeliveryResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const deliveryDays = filtered
    .map((order) => {
      const orderDate = getSafeDate(order.order_date);
      const deliveryDate = getSafeDate(order.delivery_date);
      if (!orderDate || !deliveryDate) return null;
      return Math.max(0, Math.round((deliveryDate.getTime() - orderDate.getTime()) / 86400000));
    })
    .filter((value): value is number => value !== null);

  const avg = deliveryDays.length
    ? Number((deliveryDays.reduce((sum, value) => sum + value, 0) / deliveryDays.length).toFixed(1))
    : 0;

  return {
    answer:
      locale === 'vi'
        ? `Thời gian giao trung bình trong 3 tháng gần nhất là ${avg} ngày.`
        : `Average delivery time in the last 3 months is ${avg} days (order_date to delivery_date, orders with both dates).`,
    explanation:
      locale === 'vi'
        ? 'Tính số ngày giữa order_date và delivery_date rồi lấy trung bình.'
        : 'Computes days between order_date and delivery_date, then averages across qualifying orders.',
    suggested_chart: 'KPI card',
    filters: { time_range: 'last_3_months', metric: 'avg_delivery_days' },
    data: [{ avg_delivery_days: avg, sample_size: deliveryDays.length }]
  };
}

function buildTopRegionResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const regionCounts = new Map<string, number>();

  filtered.forEach((order) => {
    regionCounts.set(order.region, (regionCounts.get(order.region) || 0) + 1);
  });

  const data = Array.from(regionCounts.entries())
    .map(([region, order_count]) => ({ region, order_count }))
    .sort((a, b) => Number(b.order_count) - Number(a.order_count));

  const top = data[0];

  return {
    answer:
      locale === 'vi'
        ? `Khu vực có nhiều đơn nhất trong 3 tháng gần nhất là ${top?.region || 'N/A'} với ${top?.order_count || 0} đơn.`
        : `The region with the most orders in the last 3 months is ${top?.region || 'N/A'} with ${top?.order_count || 0} orders.`,
    explanation:
      locale === 'vi'
        ? 'Nhóm theo cột region và đếm số đơn trong 3 tháng gần nhất.'
        : 'Groups by the region column and counts orders in the last 3 months.',
    suggested_chart: 'Bar chart',
    filters: { time_range: 'last_3_months', dimension: 'region', metric: 'order_count' },
    data: data.slice(0, 5)
  };
}

function buildPromoOrdersResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const filtered = getLastMonthsOrders(orders);
  const promo = filtered.filter((order) => order.is_promo === '1').length;

  return {
    answer:
      locale === 'vi'
        ? `Trong 3 tháng gần nhất, ${promo}/${filtered.length} đơn có khuyến mãi (is_promo=1).`
        : `In the last 3 months, ${promo} of ${filtered.length} orders used a promotion (is_promo=1).`,
    explanation:
      locale === 'vi'
        ? 'Đếm các đơn có is_promo=1 trong cửa sổ 3 tháng gần nhất.'
        : 'Counts orders with is_promo=1 in the last 3 months window.',
    suggested_chart: 'KPI card',
    filters: { time_range: 'last_3_months', metric: 'promo_orders', is_promo: '1' },
    data: [{ promo_orders: promo, total_orders: filtered.length }]
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

  if (!q.trim()) {
    const dashboard = buildDashboard(orders);
    return {
      answer: 'Here is the current logistics overview.',
      explanation: 'This dashboard summarizes the latest 3 months of logistics performance using CSV data.',
      suggested_chart: 'KPI + trend chart',
      filters: { time_range: 'last_3_months' },
      data: dashboard.status_breakdown,
      dashboard,
      provider: 'csv-rule'
    };
  }

  if (/(delay|delayed|trễ|trễ hẹn|late)/i.test(q) && /(week|tuần)/i.test(q)) {
    return buildDelayedByWeekResult(question, orders);
  }

  if (/(last month|tháng trước|latest month)/i.test(q) && /(delay|delayed|trễ|late)/i.test(q)) {
    return buildLastMonthDelayedResult(question, orders);
  }

  if (/(carrier|hãng|shipper|vendor)/i.test(q) && /(delay|delayed|trễ|late)/i.test(q)) {
    return buildCarrierDelayResult(question, orders);
  }

  if (/(cost|chi phí|value|giá trị|route|tuyến)/i.test(q) && /(highest|cao nhất|top|max)/i.test(q)) {
    return buildRouteCostResult(question, orders);
  }

  if (/exception/i.test(q)) {
    return buildExceptionCountResult(question, orders);
  }

  if (/in[- ]?transit/i.test(q)) {
    return buildInTransitResult(question, orders);
  }

  if (/(average|avg|mean)/i.test(q) && /(delivery|deliver)/i.test(q)) {
    return buildAvgDeliveryResult(question, orders);
  }

  if (/region/i.test(q) && /(most|highest|top|max)/i.test(q)) {
    return buildTopRegionResult(question, orders);
  }

  if (/promo/i.test(q)) {
    return buildPromoOrdersResult(question, orders);
  }

  if (/(summary|overview|order status|tổng quan)/i.test(q)) {
    return buildSummaryResult(question, orders);
  }

  return buildSummaryResult(question, orders);
}

async function callLlm(question: string, promptTemplate: string) {
  const provider = DEFAULT_PROVIDER.toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (provider === 'groq' && groqKey) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: promptTemplate },
          { role: 'user', content: question }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  }

  if (provider === 'gemini' && geminiKey) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${promptTemplate}\n\nUser question: ${question}` }] }]
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ question: '' }));
  const { question } = body;

  try {
    const orders = await loadOrders();
    const result = buildAnalyticsResult(question, orders);
    const promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    const provider = DEFAULT_PROVIDER.toLowerCase();
    const promptSource = 'code';

    if (question && provider !== 'rule-based') {
      const llmText = await callLlm(question, promptTemplate);
      if (llmText) {
        return Response.json({
          ok: true,
          provider,
          result: {
            ...result,
            answer: llmText,
            explanation: `${result.explanation} (LLM prompt: ${promptSource})`,
            provider,
            prompt_config: { provider, prompt_source: promptSource }
          },
          prompt_config: { provider, prompt_source: promptSource }
        });
      }
    }

    return Response.json({
      ok: true,
      provider: 'csv-rule',
      result: {
        ...result,
        provider: 'csv-rule',
        prompt_config: { provider, prompt_source: promptSource }
      },
      prompt_config: { provider, prompt_source: promptSource }
    });
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
