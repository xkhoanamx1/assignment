/** Auto-generated from mock_logistics_data.csv — run: node scripts/generate-test-cases.mjs */
export type LogisticsTestCase = {
  id: string;
  question: string;
  expectedAnswer: string;
  category: string;
};

export const LOGISTICS_TEST_CASES: LogisticsTestCase[] = [
  {
    "id": "tc-01",
    "question": "Show delayed orders by week for the last 3 months",
    "expectedAnswer": "There are 10 delayed orders in the last 3 months. The peak week is 2025-W41 with 2 delays.",
    "category": "Diagnostic"
  },
  {
    "id": "tc-02",
    "question": "Which carrier has the highest delay rate?",
    "expectedAnswer": "The carrier with the highest delay rate is USPS at 26.7% over the last 3 months.",
    "category": "Diagnostic"
  },
  {
    "id": "tc-03",
    "question": "Which route has the highest total order value in the last 3 months?",
    "expectedAnswer": "The route with the highest total order value is Newark, NJ → Boston, MA at 628.17 USD.",
    "category": "Descriptive"
  },
  {
    "id": "tc-04",
    "question": "Give me a summary of order status for the last 3 months",
    "expectedAnswer": "In the last 3 months there are 74 orders, 56 delivered, 10 delayed, with an on-time rate of 75.7%.",
    "category": "Descriptive"
  },
  {
    "id": "tc-05",
    "question": "How many orders were delivered late last month?",
    "expectedAnswer": "In 2025-12 (calendar month of the latest order in the dataset), 3 orders have status \"delayed\" (24 orders placed that month).",
    "category": "Diagnostic"
  },
  {
    "id": "tc-06",
    "question": "How many exception orders are in the last 3 months?",
    "expectedAnswer": "In the last 3 months there are 1 order with status \"exception\".",
    "category": "Descriptive"
  },
  {
    "id": "tc-07",
    "question": "How many in-transit orders are in the last 3 months?",
    "expectedAnswer": "In the last 3 months there are 7 orders currently marked \"in_transit\".",
    "category": "Descriptive"
  },
  {
    "id": "tc-08",
    "question": "What is the average delivery time in the last 3 months?",
    "expectedAnswer": "Average delivery time in the last 3 months is 3.5 days (order_date to delivery_date, orders with both dates).",
    "category": "Descriptive"
  },
  {
    "id": "tc-09",
    "question": "Which region has the most orders in the last 3 months?",
    "expectedAnswer": "The region with the most orders in the last 3 months is US-E with 26 orders.",
    "category": "Descriptive"
  },
  {
    "id": "tc-10",
    "question": "How many promotional orders were placed in the last 3 months?",
    "expectedAnswer": "In the last 3 months, 10 of 74 orders used a promotion (is_promo=1).",
    "category": "Descriptive"
  }
];
