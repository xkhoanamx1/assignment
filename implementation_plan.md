# Kế hoạch triển khai bài tập Logistics Analytics Dashboard

## 1. Tóm tắt yêu cầu đã đọc từ tài liệu

Tôi đã đọc đầy đủ nội dung từ [data/logistics-spec.pdf](data/logistics-spec.pdf) và các yêu cầu chính là:

- Xây dựng một web app gồm hai phần:
  - dashboard analytics truyền thống (KPIs + biểu đồ)
  - giao diện hỏi đáp bằng ngôn ngữ tự nhiên
- Dữ liệu dùng chung là một dataset logistics đã cho.
- Hệ thống cần hỗ trợ:
  - descriptive analytics: KPI và chart
  - diagnostic analytics: trả lời câu hỏi bằng dữ liệu
  - predictive/prescriptive analytics: forecasting và đề xuất hành động
- Bài toán phải có explainability: mỗi câu trả lời phải kèm filter, metric, dimension, query plan và bảng dữ liệu gốc.
- Phải deploy lên URL công khai và có README.

## 2. Dữ liệu có sẵn

File CSV hiện có: [mock_logistics_data.csv](mock_logistics_data.csv)

Các cột chính:
- client_id
- order_id
- order_date
- delivery_date
- carrier
- origin_city
- destination_city
- status
- sku
- product_category
- quantity
- unit_price_usd
- order_value_usd
- is_promo
- promo_discount_pct
- region
- warehouse

## 3. Kiến trúc đề xuất

### Stack khuyến nghị
- Frontend: Next.js + React + Tailwind CSS
- Backend: FastAPI (Python)
- Database: SQLite cho MVP, có thể nâng lên PostgreSQL cho production
- Charts: Recharts hoặc Chart.js
- AI orchestration: hỗn hợp rule-based + optional LLM

### Lý do
- Next.js phù hợp cho dashboard và deployment nhanh
- FastAPI dễ thao tác với dữ liệu và forecasting
- SQLite đủ cho dataset 400 dòng, không cần setup phức tạp
- Cách tiếp cận này đủ đúng, rõ ràng và không over-engineer

## 4. Phân chia module

### A. Data layer
- Load file CSV vào database hoặc dataframe
- Tạo các bảng/query chuẩn cho việc phân tích
- Cung cấp các function:
  - get_kpis()
  - get_timeseries()
  - get_breakdown()
  - get_delayed_orders()
  - forecast_demand()

### B. Backend API
Tạo các endpoint:
- GET /api/health
- GET /api/dashboard/kpis
- GET /api/dashboard/charts
- POST /api/query
- POST /api/forecast
- GET /api/explain/{query_id}

### C. Frontend UI
Giao diện gồm:
- Header: title và mô tả ứng dụng
- KPI cards: total orders, delivered, delayed, on-time rate, avg delivery time
- Chart area: 2-3 biểu đồ
- Query panel: ô nhập câu hỏi bằng tiếng Anh tự nhiên
- Result panel: câu trả lời + chart + explanation + data table

### D. AI orchestration
Không dùng AI làm nguồn sự thật. AI chỉ làm nhiệm vụ:
1. hiểu intent của câu hỏi
2. chọn tool phù hợp
3. tạo structured input
4. gọi computation layer
5. trả kết quả kèm explanation

Cách triển khai phù hợp với MVP:
- Rule-based router trước
- Nếu có OpenAI API, dùng prompt để classify intent và map sang cấu trúc JSON
- Nếu không có API, dùng heuristic regex để xử lý các câu hỏi mẫu

## 5. Các loại query cần hỗ trợ tối thiểu

### Dashboard queries
- Tổng số đơn hàng
- Số đơn giao thành công / trễ
- Tỷ lệ đúng hẹn
- Thời gian giao trung bình
- Biểu đồ theo thời gian
- Phân tích theo carrier / region / warehouse

### Natural language queries
Các ví dụ từ spec:
- "Show delayed orders by week for the last 3 months"
- "Which carrier has the highest delay rate?"
- "How many orders were delivered late last month?"

### Forecasting queries
- "Predict demand for SKU X for the next 4 months"
- "How much inventory should I plan?"

## 6. Forecasting plan

### Phương pháp đề xuất
- Dùng dữ liệu lịch sử theo tuần/tháng
- Áp dụng simple moving average hoặc linear regression
- Tạo forecast cho 3-6 tháng tới
- Tính inventory recommendation dựa trên forecast và mức tồn kho trung bình

### Output của forecasting tool
- historical values
- forecast values
- chart comparison
- recommendation
- methodology explanation

## 7. Explainability plan

Mỗi response nên có section:
- Filters applied
- Metrics used
- Dimensions used
- Query plan / structured interpretation
- Sample data table

Ví dụ:
- Time range: last 3 months
- Metric: delayed orders count
- Dimension: week
- Query plan: group by week -> filter status=delayed

## 8. Deployment plan

### MVP deployment
- Deploy frontend + backend lên một platform dễ dùng như Render, Railway, Vercel + Render
- Nếu dùng Next.js full-stack thì có thể deploy lên Vercel
- Nếu dùng FastAPI riêng thì deploy lên Render

### Yêu cầu submit
- Repository link
- Deployed URL
- Credentials nếu có auth
- README đầy đủ

## 9. Kế hoạch thực hiện theo từng bước

### Bước 1: Data prep (1-2 giờ)
- Load CSV
- Clean data
- Tạo các derived fields: delivery_delay_days, on_time flag, month/week

### Bước 2: Backend core APIs (2-3 giờ)
- KPI API
- Chart API
- Query API
- Forecast API

### Bước 3: Frontend dashboard (2-3 giờ)
- UI cho KPI và chart
- Query input + result panel

### Bước 4: AI orchestration (1-2 giờ)
- Intent detection
- Rule-based tool selection
- Explanation output

### Bước 5: README + deployment (1 giờ)
- Setup guide
- Environment variables
- Deployment notes

## 10. Scope phù hợp cho bài test

Để đúng với tinh thần bài test, nên chọn scope MVP:
- 5 KPI chính
- 2-3 chart chính
- 3-4 loại query mẫu
- 1 forecasting flow đơn giản
- explainability rõ ràng
- deployment ổn định

Không cần làm quá phức tạp để tránh mất thời gian.

## 11. Khuyến nghị triển khai ngay

Ưu tiên làm theo hướng sau để đạt hiệu quả cao nhất:
1. Dùng FastAPI + SQLite + Next.js
2. Query engine dùng pandas/polars để xử lý dữ liệu
3. Router dùng rule-based trước
4. Forecast dùng simple moving average
5. Deploy lên Render/Vercel

Nếu cần, tôi có thể tiếp tục chuyển kế hoạch này thành code khung project ngay lập tức.

## 12. Provider configuration (cập nhật sau khi review)

API `/api/query` đọc `ANALYTICS_PROVIDER` và `ANALYTICS_PROMPT_TEMPLATE` từ `.env.local`:

- `rule-based` (mặc định): không gọi LLM, trả lời rule-based từ CSV. Đây là mode đang chạy cho 10 test case demo.
- `groq`: gọi Groq (`llama-3.1-8b-instant`) với `GROQ_API_KEY`. LLM insight được thêm vào phần explanation nhưng giữ nguyên câu trả lời rule-based để test case vẫn khớp expected answer.
- `gemini`: gọi Gemini (`gemini-2.0-flash`) với `GEMINI_API_KEY`. Lưu ý: `GEMINI_API_KEY` phải là Google AI Studio key (bắt đầu bằng `AIza...`), không phải Azure gateway token (`AQ.`).
- `auto`: ưu tiên Groq nếu có key, fallback sang Gemini.

Khi LLM thất bại (lỗi mạng, quota, key sai), response vẫn trả về `provider: 'csv-rule'` kèm `prompt_config.llm_error` để frontend hiển thị. Không có exception nào được ném ra phía client.

Để test nhanh: `npx tsx scripts/verify-llm-wiring.ts` (mock fetch, không gọi network thật).
