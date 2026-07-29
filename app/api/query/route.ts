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
  sku: string;
  product_category: string;
  quantity: number;
};

type ForecastMeta = {
  method: 'linear_regression' | 'moving_average';
  slope: number;
  intercept: number;
  historical_points: number;
  recommendation_units: number;
  safety_stock_factor: number;
  horizon_months: number;
};

type AnalyticsResult = {
  answer: string;
  explanation: string;
  suggested_chart: string;
  filters: Record<string, string | number | boolean>;
  data: Array<Record<string, unknown>>;
  metrics?: string[];
  dimensions?: string[];
  query_plan?: string;
  forecast_meta?: ForecastMeta;
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
    llm_used?: boolean;
    llm_provider?: 'groq' | 'gemini';
    llm_error?: string;
    llm_status?: string;
    rule_based_answer?: string;
    llm_data_used?: boolean;
  };
};

const DEFAULT_PROMPT_TEMPLATE = `You are a logistics analytics assistant that answers questions about shipping data. You have access to CSV facts about orders.

# Dataset schema
The CSV contains logistics data with columns:
- order_date, delivery_date (YYYY-MM-DD format)
- status: "delivered" | "delayed" | "in_transit" | "exception"
- carrier: e.g. "FedEx", "UPS", "USPS", "DHL"
- region: e.g. "US-E", "US-W", "Northeast"
- origin_city, destination_city: e.g. "Newark, NJ", "Boston, MA"
- sku, product_category, quantity, unit_price_usd, order_value_usd, is_promo, promo_discount_pct
- warehouse

A "route" is formatted as "origin_city → destination_city" (e.g., "Newark, NJ → Boston, MA").

# How to respond

## For greetings (hi, hello, hey, etc.)
Respond naturally and briefly. Introduce yourself as a logistics analytics assistant. Example:
{"answer": "Hello! I'm your logistics analytics assistant. I can help you analyze delivery data, carrier performance, and order trends. What would you like to know?", "explanation": "Greeting response", "suggested_chart": "kpi", "filters": {}, "data": []}

## For analytics questions
Analyze the CSV facts provided and compute the answer. Return a JSON object with:
- "answer": The numeric/text answer to the question
- "explanation": Brief explanation of how you derived the answer
- "suggested_chart": One of "Bar chart", "Line chart", "KPI cards", "Table", "Scatter plot"
- "filters": Any filters applied (empty object if none)
- "data": Array of data rows for the chart (can be empty if just answering a simple question)

Map chart type to data shape:
- categorical comparison (few groups) → "Bar chart"
- time series → "Line chart"
- 1-2 numbers headline → "KPI cards"
- many rows/detail → "Table"
- correlation → "Scatter plot"

Return ONLY the JSON object. No markdown fences, no prose.`;

const DEFAULT_PROVIDER = 'auto';

type ResolvedConfig = {
  provider: 'rule-based' | 'groq' | 'gemini' | 'auto';
  promptTemplate: string;
  promptSource: 'code' | 'env';
  resolvedFromEnv: boolean;
};

function resolveConfig(): ResolvedConfig {
  const envProvider = (process.env.ANALYTICS_PROVIDER || '').toLowerCase().trim();
  const envPrompt = process.env.ANALYTICS_PROMPT_TEMPLATE;

  const allowed = new Set(['rule-based', 'groq', 'gemini', 'auto']);
  const provider: ResolvedConfig['provider'] = allowed.has(envProvider)
    ? (envProvider as ResolvedConfig['provider'])
    : (DEFAULT_PROVIDER as ResolvedConfig['provider']);

  return {
    provider,
    promptTemplate: envPrompt && envPrompt.trim() ? envPrompt : DEFAULT_PROMPT_TEMPLATE,
    promptSource: envPrompt && envPrompt.trim() ? 'env' : 'code',
    resolvedFromEnv: Boolean(envProvider) || Boolean(envPrompt)
  };
}

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
      is_promo: String(record.is_promo || '0'),
      sku: String(record.sku || ''),
      product_category: String(record.product_category || ''),
      quantity: Number(record.quantity || 0)
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
    data,
    metrics: ['delayed_orders'],
    dimensions: ['week'],
    query_plan: 'filter status=delayed (last 3 months) → group by ISO week → count orders'
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
    data,
    metrics: ['delay_rate', 'total_orders', 'delayed_orders'],
    dimensions: ['carrier'],
    query_plan: 'filter last 3 months → group by carrier → count delayed / total → compute delay_rate → sort desc'
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
    data,
    metrics: ['total_order_value_usd'],
    dimensions: ['route'],
    query_plan: 'filter last 3 months → group by origin_city → destination_city → sum order_value_usd → sort desc'
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
      data: [],
      metrics: ['delayed_orders'],
      dimensions: ['month'],
      query_plan: 'pick max(order_date) → use its calendar month → filter status=delayed → count'
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
    data: [{ month: monthLabel, delayed_orders: delayed, total_orders: monthOrders.length }],
    metrics: ['delayed_orders', 'total_orders'],
    dimensions: ['month'],
    query_plan: 'identify latest month from max(order_date) → filter status=delayed → count'
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
    data: [{ status: 'exception', count }],
    metrics: ['order_count'],
    dimensions: ['status'],
    query_plan: 'filter order_date in last 3 months → filter status=exception → count'
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
    data: [{ status: 'in_transit', count }],
    metrics: ['order_count'],
    dimensions: ['status'],
    query_plan: 'filter order_date in last 3 months → filter status=in_transit → count'
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
    data: [{ avg_delivery_days: avg, sample_size: deliveryDays.length }],
    metrics: ['avg_delivery_days', 'sample_size'],
    dimensions: [],
    query_plan: 'filter last 3 months → compute (delivery_date - order_date) in days → average'
  };
}

function buildForecastResult(question: string, orders: OrderRow[]): AnalyticsResult {
  const locale = isVietnamese(question) ? 'vi' : 'en';
  const horizonMatch = question.match(/(\d+)\s*(month|tháng|months|month)\b/i);
  const horizon = horizonMatch ? Math.max(1, Math.min(12, Number(horizonMatch[1]))) : 4;
  const safetyStockFactor = 1.2;

  const skuMatch = question.match(/SKU[- ]?([A-Z0-9]+-\d+)/i);
  const sku = skuMatch ? skuMatch[1].toUpperCase() : null;

  const source = sku
    ? orders.filter((order) => order.sku.toUpperCase() === sku)
    : orders;

  const monthlyMap = new Map<string, number>();
  source.forEach((order) => {
    const date = getSafeDate(order.order_date);
    if (!date) return;
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + (order.quantity || 0));
  });

  const historical = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, quantity]) => ({ month, historical: Number(quantity.toFixed(2)), forecast: null as number | null }));

  let method: 'linear_regression' | 'moving_average' = 'linear_regression';
  let slope = 0;
  let intercept = 0;

  const quantities = historical.map((row) => Number(row.historical));
  const lastMonthLabel = historical.length
    ? historical[historical.length - 1].month
    : null;

  const forecast: Array<{ month: string; historical: number | null; forecast: number }> = [];

  if (historical.length >= 2) {
    const n = historical.length;
    const xs = quantities.map((_, idx) => idx);
    const meanX = xs.reduce((s, x) => s + x, 0) / n;
    const meanY = quantities.reduce((s, y) => s + y, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += (xs[i] - meanX) * (quantities[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    slope = den === 0 ? 0 : num / den;
    intercept = meanY - slope * meanX;
  } else {
    method = 'moving_average';
  }

  const nextMonths = lastMonthLabel
    ? Array.from({ length: horizon }, (_, i) => {
        const [yStr, mStr] = lastMonthLabel.split('-');
        const y = Number(yStr);
        const m = Number(mStr) - 1;
        const d = new Date(y, m + i + 1, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })
    : [];

  if (method === 'linear_regression') {
    const baseIndex = historical.length;
    nextMonths.forEach((month, i) => {
      const predicted = Math.max(0, Number((intercept + slope * (baseIndex + i)).toFixed(2)));
      forecast.push({ month, historical: null, forecast: predicted });
    });
  } else {
    const window = quantities.slice(-3);
    const avg = window.length ? window.reduce((s, v) => s + v, 0) / window.length : 0;
    nextMonths.forEach((month) => {
      forecast.push({ month, historical: null, forecast: Number(avg.toFixed(2)) });
    });
  }

  const data = [...historical, ...forecast];
  const forecastValues = forecast.map((row) => row.forecast);
  const peakForecast = forecastValues.length ? Math.max(...forecastValues) : 0;
  const meanForecast = forecastValues.length
    ? forecastValues.reduce((s, v) => s + v, 0) / forecastValues.length
    : 0;
  const recommendationUnits = Math.ceil(meanForecast * safetyStockFactor);

  const scopeLabel = sku
    ? locale === 'vi' ? `SKU ${sku}` : `SKU ${sku}`
    : locale === 'vi' ? 'tổng sản phẩm' : 'all SKUs';

  const answer = locale === 'vi'
    ? `Dự báo nhu cầu cho ${scopeLabel} trong ${horizon} tháng tới: trung bình ${meanForecast.toFixed(1)} đơn vị/tháng, đỉnh ${peakForecast.toFixed(1)} đơn vị. Khuyến nghị tồn kho: ${recommendationUnits} đơn vị (hệ số an toàn ${safetyStockFactor}).`
    : `Demand forecast for ${scopeLabel} over the next ${horizon} months: average ${meanForecast.toFixed(1)} units/month, peak ${peakForecast.toFixed(1)} units. Inventory recommendation: ${recommendationUnits} units (safety-stock factor ${safetyStockFactor}).`;

  const explanation = locale === 'vi'
    ? `Tổng quantity theo tháng được hồi quy tuyến tính (${historical.length} điểm lịch sử). Nếu dữ liệu quá ít, hệ thống tự fallback sang moving average 3 tháng. Tồn kho khuyến nghị = mean(forecast) × ${safetyStockFactor} đề phòng biến động.`
    : `Monthly quantity is linearly regressed on month index (${historical.length} historical points). When fewer than 2 points are available, the method falls back to a 3-month moving average. Inventory recommendation = mean(forecast) × ${safetyStockFactor} to cover demand variability.`;

  const historicalRange = historical.length
    ? `${historical[0].month} → ${historical[historical.length - 1].month}`
    : 'none';

  return {
    answer,
    explanation,
    suggested_chart: 'Line chart',
    filters: {
      time_range: historicalRange,
      sku: sku || 'all',
      horizon_months: horizon,
      metric: 'quantity',
      dimension: 'month',
      safety_stock_factor: safetyStockFactor
    },
    data: data as Array<Record<string, unknown>>,
    metrics: ['quantity', 'forecast_quantity'],
    dimensions: ['month'],
    query_plan: sku
      ? `filter sku=${sku} → group by order_date month → sum quantity → linear regression on (monthIndex, quantity) → forecast next ${horizon} months → recommend inventory = mean(forecast) × ${safetyStockFactor}`
      : `filter all orders → group by order_date month → sum quantity → linear regression on (monthIndex, quantity) → forecast next ${horizon} months → recommend inventory = mean(forecast) × ${safetyStockFactor}`,
    forecast_meta: {
      method,
      slope: Number(slope.toFixed(4)),
      intercept: Number(intercept.toFixed(4)),
      historical_points: historical.length,
      recommendation_units: recommendationUnits,
      safety_stock_factor: safetyStockFactor,
      horizon_months: horizon
    },
    provider: 'csv-rule'
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
    data: data.slice(0, 5),
    metrics: ['order_count'],
    dimensions: ['region'],
    query_plan: 'filter last 3 months → group by region → count → sort desc → top 5'
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
    data: [{ promo_orders: promo, total_orders: filtered.length }],
    metrics: ['promo_orders', 'total_orders'],
    dimensions: [],
    query_plan: 'filter last 3 months → filter is_promo=1 → count'
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
    ],
    metrics: ['order_count', 'on_time_rate'],
    dimensions: ['status'],
    query_plan: 'filter last 3 months → group by status → count → compute on-time rate'
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
      metrics: ['total_orders', 'delivered', 'delayed', 'on_time_rate', 'avg_delivery_days'],
      dimensions: ['status', 'month', 'carrier'],
      query_plan: 'filter last 3 months → aggregate KPIs (total/delivered/delayed/avg delivery/OTR) → group by month for trend → group by carrier for delay rate',
      dashboard,
      provider: 'csv-rule'
    };
  }

  if (/(forecast|predict|demand|dự báo|dự đoán)/i.test(q) || /(sku|product|sản phẩm)/i.test(q)) {
    return buildForecastResult(question, orders);
  }

  if (/(inventory|tồn kho|stock)/i.test(q)) {
    return buildForecastResult(question, orders);
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

async function callGroq(question: string, promptTemplate: string): Promise<{ text: string; raw: unknown } | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

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

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Groq API ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || null;
  return text ? { text, raw: data } : null;
}

async function callGemini(question: string, promptTemplate: string): Promise<{ text: string; raw: unknown } | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${promptTemplate}\n\nUser question: ${question}` }] }]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini API ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  return text ? { text, raw: data } : null;
}

async function tryLlm(question: string, promptTemplate: string, provider: ResolvedConfig['provider']): Promise<{
  text: string;
  effectiveProvider: 'groq' | 'gemini';
} | null> {
  const order: Array<'groq' | 'gemini'> =
    provider === 'gemini' ? ['gemini', 'groq'] :
    provider === 'auto' ? (process.env.GROQ_API_KEY ? ['groq', 'gemini'] : ['gemini', 'groq']) :
    ['groq'];

  for (const candidate of order) {
    try {
      const result = candidate === 'groq'
        ? await callGroq(question, promptTemplate)
        : await callGemini(question, promptTemplate);
      if (result) return { text: result.text, effectiveProvider: candidate };
    } catch (err) {
      console.warn(`[query] ${candidate} call failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

function stripJsonComments(text: string): string {
  // Remove // line comments and /* ... */ block comments outside of string literals.
  // The LLM sometimes leaks JS-style comments into JSON; this rescues those responses
  // without disturbing valid JSON that contains ":" or "//" inside string values.
  let result = '';
  let i = 0;
  let inString = false;
  let stringQuote = '';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      result += ch;
      if (ch === '\\' && i + 1 < text.length) {
        result += next;
        i += 2;
        continue;
      }
      if (ch === stringQuote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

function extractFirstJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = trimmed.startsWith('{') ? trimmed : null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = direct || (fenced ? fenced[1].trim() : null);
  if (!candidate) return null;
  const attempts = [candidate, stripJsonComments(candidate)];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next attempt
    }
  }
  return null;
}

function summarizeLlmText(text: string): string {
  const cleaned = text.trim();
  return cleaned.length > 600 ? `${cleaned.slice(0, 600)}...` : cleaned;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ question: '' }));
  const { question } = body;
  const config = resolveConfig();

  try {
    const orders = await loadOrders();
    const baseResult = buildAnalyticsResult(question, orders);

    // Greeting detection - still goes through LLM but we note it
    const greetingPattern = /^(hi|hello|hey|chào|xin chào|hi there|howdy|yo|sup|hi!|hello!|hey!)\s*$/i;
    const isGreeting = greetingPattern.test(question.trim());

    if (!question) {
      return Response.json({
        ok: true,
        provider: 'csv-rule',
        result: {
          ...baseResult,
          provider: 'csv-rule',
          prompt_config: {
            provider: config.provider,
            prompt_source: config.promptSource,
            llm_used: false,
            llm_status: 'skipped_empty_question'
          }
        },
        prompt_config: {
          provider: config.provider,
          prompt_source: config.promptSource,
          llm_used: false,
          llm_status: 'skipped_empty_question'
        }
      });
    }

    const csvFacts = orders.length <= 25
      ? JSON.stringify(orders, null, 2)
      : `${orders.length} orders in CSV.`;

    let llmText: string | null = null;
    let effectiveProvider: 'groq' | 'gemini' | null = null;
    let llmError: string | null = null;

    const wantsLlm = config.provider === 'groq' || config.provider === 'gemini' || config.provider === 'auto';

    if (wantsLlm) {
      try {
        // The LLM is a rewriter, not a recomputer. We pass it the
        // authoritative values the rule-based engine just produced and ask
        // it to rephrase the explanation and pick a chart type. We do NOT
        // send the raw CSV: it is summarized in one line so the model cannot
        // attempt to compute its own answer and contradict the rule-based
        // source of truth.
        const llmPayload = JSON.stringify(
          {
            question,
            csvFacts,
            authoritative: {
              answer: baseResult.answer,
              data: baseResult.data,
              filters: baseResult.filters,
              metrics: baseResult.metrics,
              dimensions: baseResult.dimensions
            }
          },
          null,
          2
        );
        const llm = await tryLlm(question, `${config.promptTemplate}\n\n${llmPayload}`, config.provider);
        if (llm) {
          llmText = llm.text;
          effectiveProvider = llm.effectiveProvider;
        } else {
          llmError = 'No LLM provider returned a response (check API keys and quotas).';
          // User requested LLM but it failed - do NOT fall back to rule-based
          return Response.json({
            ok: false,
            provider: config.provider,
            error: llmError,
            result: null,
            prompt_config: {
              provider: config.provider,
              prompt_source: config.promptSource,
              llm_used: false,
              llm_error: llmError
            }
          }, { status: 502 });
        }
      } catch (err) {
        llmError = err instanceof Error ? err.message : 'LLM call failed.';
        // User requested LLM but it failed - do NOT fall back to rule-based
        return Response.json({
          ok: false,
          provider: config.provider,
          error: llmError,
          result: null,
          prompt_config: {
            provider: config.provider,
            prompt_source: config.promptSource,
            llm_used: false,
            llm_error: llmError
          }
        }, { status: 502 });
      }
    } else {
      llmError = 'ANALYTICS_PROVIDER is set to rule-based; LLM is disabled.';
    }

    const providerLabel = effectiveProvider ?? 'csv-rule';
    const llmUsed = Boolean(llmText);

    // Decide whether the LLM's `data` array is allowed to override the
    // rule-based rows. The rule-based engine is the only code path that
    // sees the full CSV, so its rows are authoritative whenever it has
    // them. The LLM may only contribute data when the rule-based engine
    // produced no rows (e.g. general-knowledge questions where we have
    // no analytic to anchor on).
    let parsed: Record<string, unknown> | null = llmUsed ? extractFirstJson(llmText!) : null;
    const llmJsonValid = parsed !== null;
    let llmDataOverride: Array<Record<string, unknown>> = baseResult.data;
    if (llmJsonValid && (!baseResult.data || baseResult.data.length === 0) && Array.isArray(parsed!.data)) {
      llmDataOverride = parsed!.data as Array<Record<string, unknown>>;
    }

    let primaryResult: AnalyticsResult;
    if (llmUsed && llmJsonValid) {
      primaryResult = {
        answer: typeof parsed!.answer === 'string' && parsed!.answer.trim()
          ? parsed!.answer.trim()
          : baseResult.answer,
        explanation: typeof parsed!.explanation === 'string' && parsed!.explanation.trim()
          ? parsed!.explanation.trim()
          : baseResult.explanation,
        suggested_chart: typeof parsed!.suggested_chart === 'string' && parsed!.suggested_chart.trim()
          ? parsed!.suggested_chart.trim()
          : baseResult.suggested_chart,
        filters: (parsed!.filters && typeof parsed!.filters === 'object')
          ? parsed!.filters as Record<string, string | number | boolean>
          : baseResult.filters,
        data: Array.isArray(parsed!.data) ? parsed!.data as Array<Record<string, unknown>> : baseResult.data,
        query_plan: typeof parsed!.query_plan === 'string' && parsed!.query_plan.trim()
          ? parsed!.query_plan.trim()
          : baseResult.query_plan,
        forecast_meta: baseResult.forecast_meta,
        metrics: baseResult.metrics,
        dimensions: baseResult.dimensions,
        provider: providerLabel,
        prompt_config: {
          provider: config.provider,
          prompt_source: config.promptSource,
          llm_used: true,
          llm_provider: effectiveProvider ?? undefined,
          llm_data_used: true
        }
      };
    } else if (llmUsed && !llmJsonValid) {
      primaryResult = {
        ...baseResult,
        provider: providerLabel,
        prompt_config: {
          provider: config.provider,
          prompt_source: config.promptSource,
          llm_used: true,
          llm_provider: effectiveProvider ?? undefined,
          llm_error: 'LLM response could not be parsed as JSON; rule-based answer used.',
          rule_based_answer: baseResult.answer
        }
      };
    } else {
      primaryResult = {
        ...baseResult,
        provider: providerLabel,
        prompt_config: {
          provider: config.provider,
          prompt_source: config.promptSource,
          llm_used: false,
          llm_error: llmError ?? undefined
        }
      };
    }
    return Response.json({
      ok: true,
      provider: providerLabel,
      result: primaryResult,
      prompt_config: {
        provider: config.provider,
        prompt_source: config.promptSource,
        llm_used: llmUsed,
        llm_provider: effectiveProvider ?? undefined,
        llm_error: llmError ?? undefined,
        rule_based_answer: primaryResult.prompt_config?.rule_based_answer
      }
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
