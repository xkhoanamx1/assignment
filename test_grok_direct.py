import os
import requests

key = os.environ.get('GROQ_API_KEY') or os.environ.get('XAI_API_KEY')
if not key:
    raise SystemExit('Set GROQ_API_KEY or XAI_API_KEY before running this script.')

url = 'https://api.x.ai/v1/chat/completions'
payload = {
    'model': 'grok-beta',
    'messages': [{'role': 'user', 'content': 'Reply with JSON: {"answer":"ok","explanation":"test"}'}],
    'temperature': 0.2
}
headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}
try:
    r = requests.post(url, headers=headers, json=payload, timeout=30)
    print('status', r.status_code)
    print(r.text)
except Exception as e:
    print('ERROR', e)
