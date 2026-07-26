# Logistics Gemini Demo

This is a simple Vercel-ready demo for a logistics analytics assistant.

## Environment variables

Set the following in Vercel:

- GEMINI_API_KEY=your_google_gemini_api_key

## Local development

```bash
npm install
npm run dev
```

## Demo test cases

1. "Show delayed orders by week for the last 3 months"
2. "Which carrier has the highest delay rate?"
3. "How many orders were delivered late last month?"
4. "Predict demand for SKU PAPER-0197 for the next 4 months"
5. "How much inventory should I plan?"

Expected behavior:
- The app should route the query to the appropriate analytics or forecasting handler.
- The response should include an answer, explanation, suggested chart, and filters.
